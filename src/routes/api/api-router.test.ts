/* eslint-disable @typescript-eslint/no-explicit-any */
import supertest from "supertest";
import express, { Application, NextFunction, Request, Response } from "express";
import { Installation } from "models/installation";
import { Subscription } from "models/subscription";
import { RepoSyncState } from "models/reposyncstate";
import { ApiRouter } from "routes/api/api-router";
import { getLogger } from "config/logger";

describe("API Router", () => {
	let app: Application;
	let locals;
	const invalidId = 99999999;
	const gitHubInstallationId = 1234;
	let installation: Installation;
	let subscription: Subscription;

	const createApp = () => {
		const app = express();
		app.use((req: Request, res: Response, next: NextFunction) => {
			res.locals = locals || {};
			req.log = getLogger("test");
			req.session = { jiraHost };
			next();
		});
		app.use("/api", ApiRouter);
		return app;
	};

	beforeEach(async () => {
		locals = {
			client: {
				apps: {
					getInstallation: jest.fn().mockResolvedValue({ data: {} })
				}
			}
		};
		app = createApp();

		installation = await Installation.create({
			gitHubInstallationId,
			jiraHost,
			sharedSecret: "secret",
			clientKey: "client-key"
		});

		subscription = await Subscription.create({
			gitHubInstallationId,
			jiraHost,
			jiraClientKey: "client-key"
		});
	});

	it("should GET syncstate", async () => {

		await supertest(app)
			.get(`/api/${subscription.gitHubInstallationId}/${encodeURIComponent(subscription.jiraHost)}/syncstate`)
			.set("X-Slauth-Mechanism", "asap")
			.then((response) => {
				expect(response.body).toMatchObject({
					jiraHost,
					gitHubInstallationId,
					numberOfSyncedRepos: 0,
					totalNumberOfRepos: 0,
					repositories: []
				});
			});
	});

	describe("Authentication based on SLAuth headers", () => {
		it("Request allowed when Authentication Mechanism is ASAP", () => {
			return supertest(app)
				.get("/api")
				.set("X-Slauth-Mechanism", "asap")
				.set("X-Slauth-Principal", "pollinator-check/fea5d423-e21f-465b-aa67-54c8367b7777")
				.expect(200)
				.then((response) => {
					expect(response.body).toMatchSnapshot();
				});
		});

		it("Request allowed when Authentication Mechanism is SLAuth Token", () => {
			return supertest(app)
				.get("/api")
				.set("X-Slauth-Mechanism", "slauthtoken")
				.set("X-Slauth-Principal", "group")
				.set("X-Slauth-User-Groups", "micros-sv--github-for-jira-dl-admins")
				.expect(200)
				.then((response) => {
					expect(response.body).toMatchSnapshot();
				});
		});

		it("should return 401 no SLauth Headers", () => {

			return supertest(app)
				.get("/api")
				.then((response) => {
					expect(response.status).toEqual(401);
				});
		});

		it("should return 401 when Authentication Mechanism is Open", () => {

			return supertest(app)
				.get("/api")
				.set("X-Slauth-Mechanism", "open")
				.then((response) => {
					expect(response.status).toEqual(401);
				});
		});
	});

	describe("Endpoints", () => {

		describe("verify", () => {
			it("should return 'Installation already enabled'", () => {
				jiraNock
					.get("/rest/devinfo/0.10/existsByProperties?fakeProperty=1")
					.reply(200);

				return supertest(app)
					.post(`/api/jira/${installation.id}/verify`)
					.set("X-Slauth-Mechanism", "slauthtoken")
					.expect(200)
					.expect("Content-Type", /json/)
					.then((response) => {
						expect(response.body.message).toMatchSnapshot();
					});
			});
		});

		describe("installation", () => {
			it("should return 404 if no installation is found", async () => {
				return supertest(app)
					.get(`/api/${invalidId}`)
					.set("X-Slauth-Mechanism", "slauthtoken")
					.expect(404)
					.then((response) => {
						expect(response.body).toMatchSnapshot();
					});
			});

			it("should return information for an existing installation", async () => {
				return supertest(app)
					.get(`/api/${gitHubInstallationId}`)
					.set("host", "127.0.0.1")
					.send({ jiraHost })
					.set("X-Slauth-Mechanism", "slauthtoken")
					.expect(200)
					.then((response) => {
						expect(response.body).toMatchSnapshot();
					});
			});
		});

		describe("Repo Sync State", () => {
			beforeEach(async () => {
				await subscription.update({ numberOfSyncedRepos: 1 });
				await RepoSyncState.create({
					subscriptionId: subscription.id,
					repoId: 1,
					repoName: "github-for-jira",
					repoOwner: "atlassian",
					repoFullName: "atlassian/github-for-jira",
					repoUrl: "github.com/atlassian/github-for-jira",
					branchStatus: "complete",
					branchCursor: "foo",
					commitStatus: "complete",
					commitCursor: "bar",
					pullStatus: "complete",
					pullCursor: "12",
					buildStatus: "complete",
					buildCursor: "bang",
					deploymentStatus: "complete",
					deploymentCursor: "buzz",
					repoUpdatedAt: new Date(0)
				});
			});

			it("should return 404 if no installation is found", async () => {
				return supertest(app)
					.get(`/api/${invalidId}/${encodeURIComponent(jiraHost)}/syncstate`)
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.send({ jiraHost })
					.expect(404)
					.then((response) => {
						expect(response.body).toMatchSnapshot();
					});
			});

			it("should return the sync state for an existing installation", async () => {
				return supertest(app)
					.get(`/api/${gitHubInstallationId}/${encodeURIComponent(jiraHost)}/syncstate`)
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.expect(200)
					.then((response) => {
						expect(response.body).toMatchObject({
							jiraHost,
							gitHubInstallationId,
							numberOfSyncedRepos: 1,
							totalNumberOfRepos: 1,
							repositories: [{
								pullStatus: "complete",
								branchStatus: "complete",
								commitStatus: "complete",
								buildStatus: "complete",
								deploymentStatus: "complete",
								repoId: 1,
								repoName: "github-for-jira",
								repoFullName: "atlassian/github-for-jira",
								repoUrl: "github.com/atlassian/github-for-jira",
								repoOwner: "atlassian",
								repoUpdatedAt: new Date(0).toISOString()
							}]
						});
					});
			});
		});

		describe("sync", () => {
			it("should return 404 if no installation is found", async () => {
				return supertest(app)
					.post(`/api/${invalidId}/sync`)
					.set("Content-Type", "application/json")
					.send({ jiraHost: "https://unknownhost.atlassian.net" })
					.set("X-Slauth-Mechanism", "slauthtoken")
					.expect(404)
					.then((response) => {
						expect(response.text).toMatchSnapshot();
					});
			});

			it("should trigger the sync or start function", async () => {
				return supertest(app)
					.post(`/api/${gitHubInstallationId}/sync`)
					.set("Content-Type", "application/json")
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.send({ jiraHost })
					.expect(202)
					.then((response) => {
						expect(response.text).toMatchSnapshot();
					});
			});

			it("should reset sync state if asked to", async () => {
				return supertest(app)
					.post(`/api/${gitHubInstallationId}/sync`)
					.set("Content-Type", "application/json")
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.send({ jiraHost, resetType: "full" })
					.expect(202)
					.then((response) => {
						expect(response.text).toMatchSnapshot();
					});
			});
		});

		describe("Delete Installation", () => {
			beforeEach(() => {
				jiraNock
					.delete("/rest/devinfo/0.10/bulkByProperties")
					.query({ installationId: gitHubInstallationId })
					.reply(200);

				jiraNock
					.delete("/rest/builds/0.1/bulkByProperties")
					.query({ gitHubInstallationId })
					.reply(200);

				jiraNock
					.delete("/rest/deployments/0.1/bulkByProperties")
					.query({ gitHubInstallationId })
					.reply(200);
			});

			it("Should work with old delete installation route", () => {
				return supertest(app)
					.delete(`/api/deleteInstallation/${gitHubInstallationId}/${encodeURIComponent(jiraHost)}`)
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.expect(200)
					.then((response) => {
						expect(response.body).toMatchSnapshot();
					});
			});

			it("Should work with new delete installation route", () => {
				return supertest(app)
					.delete(`/api/${gitHubInstallationId}/${encodeURIComponent(jiraHost)}`)
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.expect(200)
					.then((response) => {
						expect(response.body).toMatchSnapshot();
					});
			});
		});

		describe("Hash data", () => {

			it("Should return error with message if no data provided", () => {
				return supertest(app)
					.post("/api/hash")
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.expect(400)
					.then((response) => {
						expect(response.body?.message).toEqual("Please provide a value to be hashed.");
					});
			});

			it("Should return hashed value of data", () => {
				return supertest(app)
					.post("/api/hash")
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.send({ data: "encrypt_this_yo" })
					.expect(200)
					.then((response) => {
						expect(response.body?.originalValue).toEqual("encrypt_this_yo");
						expect(response.body?.hashedValue).toEqual("a539e6c6809cabace5719df6c7fb52071ee15e722ba89675f6ad06840edaa287");
					});
			});

		});

		describe("Ping", () => {

			it("Should fail on missing url", () => {
				return supertest(app)
					.post("/api/ping")
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.expect(400)
					.then((response) => {
						expect(response.body?.message).toEqual("Please provide a JSON object with the field 'url'.");
					});
			});

			it("Should return error on failed ping", () => {
				return supertest(app)
					.post("/api/ping")
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.send({ data: { url: "http://github-does-not-exist.internal.atlassian.com" } })
					.expect(200)
					.then((response) => {
						expect(response.body?.error.code).toEqual("ENOTFOUND");
					});
			});

			// skipped out because I just used it as a manual test and don't want to make real calls in CI
			it.skip("Should return 200 on successful ping", () => {
				return supertest(app)
					.post("/api/ping")
					.set("host", "127.0.0.1")
					.set("X-Slauth-Mechanism", "slauthtoken")
					.send({ data: { url: "https://google.com" } })
					.expect(200)
					.then((response) => {
						expect(response.body?.statusCode).toEqual(200);
					});
			});

		});
	});
});
