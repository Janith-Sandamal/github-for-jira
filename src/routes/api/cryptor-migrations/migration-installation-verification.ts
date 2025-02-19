import { Request, Response } from "express";
import { Installation } from "models/installation";

export const CryptorMigrationInstallationVerificationPost = async (req: Request, res: Response): Promise<void> => {

	const jiraHost: string = req.body?.jiraHost;

	if (!jiraHost) {
		res.status(200).json({ ok: false, reason: "invalid jiraHost param in body" });
		return;
	}

	const inst = await Installation.getForHost(jiraHost);
	if (!inst) {
		res.status(200).json({ ok: false, reason: "Could not find installation for jiraHost" });
		return;
	}

	if (!inst.encryptedSharedSecret) {
		res.status(200).json({ ok: false, reason: "Empty encryptedSharedSecret" });
		return;
	}

	try {
		if (inst.sharedSecret === (await inst.decrypt("encryptedSharedSecret"))) {
			res.status(200).json({ ok: true });
			return;
		} else {
			res.status(200).json({ ok: false, reason: "different values to sharedSecret" });
			return;
		}
	} catch (e) {
		res.status(200).json({ ok: false, reason: e.message });
		return;
	}

};
