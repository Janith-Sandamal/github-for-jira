import * as Sentry from "@sentry/node";
import { GitHubAPI } from "probot";
import Logger from "bunyan";
import { GitHubAppConfig } from "~/src/sqs/sqs.types";

type WebhookContextConstructorParam <E = any> = {
	id: string;
	name: string;
	payload: E;
	log: Logger;
	action?: string;
	gitHubAppConfig?: GitHubAppConfig;
}

export class WebhookContext<E = any> {
	id: string;
	name: string;
	payload: E;
	log: Logger;
	action?: string;
	sentry?: Sentry.Hub;
	timedout?: number;
	webhookReceived?: number;
	gitHubAppConfig?: GitHubAppConfig;
	// Todo: delete github once all references to github has been removed. Found some reference behind FF
	github: GitHubAPI;

	constructor({ id, name, payload, log, action, gitHubAppConfig }: WebhookContextConstructorParam<E>) {
		this.id = id;
		this.name = name;
		this.payload = payload;
		this.log = log;
		this.action = action;
		this.gitHubAppConfig = gitHubAppConfig;
	}
}
