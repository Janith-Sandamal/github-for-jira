/* eslint-disable @typescript-eslint/no-var-requires,@typescript-eslint/no-explicit-any */
import { removeInterceptor } from "nock";
import { processInstallation } from "./installation";
import { Installation } from "models/installation";
import { RepoSyncState } from "models/reposyncstate";
import { Subscription } from "models/subscription";
import { sqsQueues } from "../sqs/queues";
import { getLogger } from "config/logger";
import { Hub } from "@sentry/types/dist/hub";
import { BackfillMessagePayload } from "../sqs/sqs.types";

import deploymentNodesFixture from "fixtures/api/graphql/deployment-nodes.json";
import mixedDeploymentNodes from "fixtures/api/graphql/deployment-nodes-mixed.json";
import { getDeploymentsQuery } from "~/src/github/client/github-queries";
import { waitUntil } from "test/utils/wait-until";

jest.mock("../sqs/queues");
jest.mock("config/feature-flags");

describe("sync/deployments", () => {
	const installationId = 1234;
	const sentry: Hub = { setUser: jest.fn() } as any;
	const mockBackfillQueueSendMessage = jest.mocked(sqsQueues.backfill.sendMessage);

	const makeExpectedJiraResponse = (deployments) => ({
		deployments,
		properties: {
			"gitHubInstallationId": 1234
		}
	});

	const createGitHubNock = (deploymentsResponse?) => {
		githubNock
			.post("/graphql", {
				query: getDeploymentsQuery,
				variables: {
					owner: "integrations",
					repo: "test-repo-name",
					per_page: 20
				}
			})
			.query(true)
			.reply(200, deploymentsResponse);
	};

	const createJiraNock = (deployments) => {
		jiraNock
			.post("/rest/deployments/0.1/bulk", makeExpectedJiraResponse(deployments))
			.reply(200);
	};

	beforeEach(async () => {

		mockSystemTime(12345678);

		await Installation.create({
			gitHubInstallationId: installationId,
			jiraHost,
			sharedSecret: "secret",
			clientKey: "client-key"
		});

		const subscription = await Subscription.create({
			gitHubInstallationId: installationId,
			jiraHost,
			syncStatus: "ACTIVE",
			repositoryStatus: "complete"
		});

		await RepoSyncState.create({
			subscriptionId: subscription.id,
			repoId: 1,
			repoName: "test-repo-name",
			repoOwner: "integrations",
			repoFullName: "test-repo-name",
			repoUrl: "test-repo-url",
			repoUpdatedAt: new Date(),
			repoPushedAt: new Date(),
			branchStatus: "complete",
			commitStatus: "complete",
			pullStatus: "complete",
			deploymentStatus: "pending", // We want the next process to be deployment
			buildStatus: "complete",
			updatedAt: new Date(),
			createdAt: new Date()
		});

		jest.mocked(sqsQueues.backfill.sendMessage).mockResolvedValue();
		githubUserTokenNock(installationId);
	});

	const verifyMessageSent = async (data: BackfillMessagePayload, delaySec ?: number) => {
		await waitUntil(async () => {
			expect(githubNock).toBeDone();
			expect(jiraNock).toBeDone();
		});
		expect(mockBackfillQueueSendMessage.mock.calls).toHaveLength(1);
		expect(mockBackfillQueueSendMessage.mock.calls[0][0]).toEqual(data);
		expect(mockBackfillQueueSendMessage.mock.calls[0][1]).toEqual(delaySec || 0);
	};

	it("should sync to Jira when Deployment messages have jira references", async () => {
		const data: BackfillMessagePayload = { installationId, jiraHost };

		githubUserTokenNock(installationId);
		githubUserTokenNock(installationId);
		githubUserTokenNock(installationId);
		githubUserTokenNock(installationId);

		createGitHubNock(deploymentNodesFixture);

		githubNock.get(`/repos/test-repo-owner/test-repo-name/commits/51e16759cdac67b0d2a94e0674c9603b75a840f6`)
			.reply(200, {
				commit: {
					author: {
						name: "test-branch-author-name",
						email: "test-branch-author-name@github.com",
						date: "test-branch-author-date"
					},
					message: "[TEST-123] test-commit-message"
				},
				html_url: `test-repo-url/commits/51e16759cdac67b0d2a94e0674c9603b75a840f6`
			});

		githubNock.get(`/repos/test-repo-owner/test-repo-name/deployments`)
			.query(true)
			.reply(200, [
				{
					"id": 1,
					"sha": "a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d",
					"ref": "topic-branch",
					"task": "deploy",
					"payload": {},
					"original_environment": "staging",
					"environment": "production",
					"description": "Deploy request from hubot",
					"creator": {
						"login": "test-repo-owner",
						"id": 1,
						"type": "User"
					},
					"created_at": "2012-07-20T01:19:13Z",
					"updated_at": "2012-07-20T01:19:13Z",
					"statuses_url": "https://api.github.com/repos/octocat/example/deployments/1/statuses",
					"repository_url": "https://api.github.com/repos/octocat/example",
					"transient_environment": false,
					"production_environment": true
				}
			]);

		githubNock.get(`/repos/test-repo-owner/test-repo-name/compare/a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d...51e16759cdac67b0d2a94e0674c9603b75a840f6`)
			.reply(200, {
				"total_commits": 2,
				"commits": [
					{
						"sha": "a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d",
						"commit": {
							"message": "base commit"
						}
					},
					{
						"sha": "51e16759cdac67b0d2a94e0674c9603b75a840f6",
						"commit": {
							"message": "head commit"
						}
					}
				]
			});

		githubNock.get(`/repos/test-repo-owner/test-repo-name/deployments/1/statuses`)
			.query(true)
			.reply(200, [
				{
					"id": 1,
					"state": "success",
					"description": "Deployment finished successfully.",
					"environment": "production"
				}
			]);

		createJiraNock([{
			"schemaVersion": "1.0",
			"deploymentSequenceNumber": 500226426,
			"updateSequenceNumber": 500226426,
			"displayName": "deploy",
			"url": "https://github.com/test-repo-owner/test-repo-name/commit/51e16759cdac67b0d2a94e0674c9603b75a840f6/checks",
			"description": "deploy",
			"lastUpdated": "2022-02-03T22:45:04.000Z",
			"state": "successful",
			"pipeline": {
				"id": "deploy",
				"displayName": "deploy",
				"url": "https://github.com/test-repo-owner/test-repo-name/commit/51e16759cdac67b0d2a94e0674c9603b75a840f6/checks"
			},
			"environment": {
				"id": "prod",
				"displayName": "prod",
				"type": "production"
			},
			"associations": [
				{
					"associationType": "issueIdOrKeys",
					"values": ["TEST-123"]
				},
				{
					"associationType": "commit",
					"values": [
						{
							"commitHash": "a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d",
							"repositoryId": "19"
						},
						{
							"commitHash": "51e16759cdac67b0d2a94e0674c9603b75a840f6",
							"repositoryId": "19"
						}
					]
				}]
		}]);

		await expect(processInstallation()(data, sentry, getLogger("test"))).toResolve();
		await verifyMessageSent(data);
	});

	it("should send Jira all deployments that have Issue Keys", async () => {
		const data = { installationId, jiraHost };

		createGitHubNock(mixedDeploymentNodes);

		["51e16759cdac67b0d2a94e0674c9603b75a840f6", "7544f2fec0321a32d5effd421682463c2ebd5018"]
			.forEach((commitId, index) => {
				index++;
				githubUserTokenNock(installationId);
				githubUserTokenNock(installationId);
				githubUserTokenNock(installationId);
				githubUserTokenNock(installationId);
				githubNock.get(`/repos/test-repo-owner/test-repo-name/commits/${commitId}`)
					.reply(200, {
						commit: {
							author: {
								name: "test-branch-author-name",
								email: "test-branch-author-name@github.com",
								date: "test-branch-author-date"
							},
							message: `[TEST-${index * 123}] test-commit-message ${index}`
						},
						html_url: `test-repo-url/commits/${commitId}`
					});

				githubNock.get(`/repos/test-repo-owner/test-repo-name/deployments`)
					.query(true)
					.reply(200, [
						{
							"id": 1,
							"sha": "a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d",
							"ref": "topic-branch",
							"task": "deploy",
							"payload": {},
							"original_environment": "staging",
							"environment": "production",
							"description": "Deploy request from hubot",
							"creator": {
								"login": "test-repo-owner",
								"id": 1,
								"type": "User"
							},
							"created_at": "2012-07-20T01:19:13Z",
							"updated_at": "2012-07-20T01:19:13Z",
							"statuses_url": "https://api.github.com/repos/octocat/example/deployments/1/statuses",
							"repository_url": "https://api.github.com/repos/octocat/example",
							"transient_environment": false,
							"production_environment": true
						}
					]);

				githubNock.get(`/repos/test-repo-owner/test-repo-name/compare/a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d...${commitId}`)
					.reply(200, {
						"total_commits": 2,
						"commits": [
							{
								"sha": "a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d",
								"commit": {
									"message": "base commit"
								}
							},
							{
								"sha": commitId,
								"commit": {
									"message": "head commit"
								}
							}
						]
					});

				githubNock.get(`/repos/test-repo-owner/test-repo-name/deployments/1/statuses`)
					.query(true)
					.reply(200, [
						{
							"id": 1,
							"state": "success",
							"description": "Deployment finished successfully.",
							"environment": "production"
						}
					]);
			});

		createJiraNock([
			{
				schemaVersion: "1.0",
				deploymentSequenceNumber: 500226426,
				updateSequenceNumber: 500226426,
				displayName: "deploy",
				url: "https://github.com/test-repo-owner/test-repo-name/commit/51e16759cdac67b0d2a94e0674c9603b75a840f6/checks",
				description: "deploy",
				lastUpdated: "2022-02-03T22:45:04.000Z",
				state: "successful",
				pipeline: {
					id: "deploy",
					displayName: "deploy",
					url: "https://github.com/test-repo-owner/test-repo-name/commit/51e16759cdac67b0d2a94e0674c9603b75a840f6/checks"
				},
				environment: {
					id: "prod",
					displayName: "prod",
					type: "production"
				},
				associations: [
					{
						associationType: "issueIdOrKeys",
						values: ["TEST-123"]
					},
					{
						associationType: "commit",
						values: [
							{
								commitHash: "a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d",
								repositoryId: "24"
							},
							{
								commitHash: "51e16759cdac67b0d2a94e0674c9603b75a840f6",
								repositoryId: "24"
							}
						]
					}
				]
			},
			{
				schemaVersion: "1.0",
				deploymentSequenceNumber: 1234,
				updateSequenceNumber: 1234,
				displayName: "deploy",
				url: "https://github.com/test-repo-owner/test-repo-name/commit/7544f2fec0321a32d5effd421682463c2ebd5018/checks",
				description: "deploy",
				lastUpdated: "2022-02-03T22:45:04.000Z",
				state: "successful",
				pipeline: {
					id: "deploy",
					displayName: "deploy",
					url: "https://github.com/test-repo-owner/test-repo-name/commit/7544f2fec0321a32d5effd421682463c2ebd5018/checks"
				},
				environment: {
					id: "prod",
					displayName: "prod",
					type: "production"
				},
				associations: [
					{
						associationType: "issueIdOrKeys",
						values: ["TEST-246"]
					},
					{
						associationType: "commit",
						values: [
							{
								commitHash: "a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d",
								repositoryId: "42"
							},
							{
								commitHash: "7544f2fec0321a32d5effd421682463c2ebd5018",
								repositoryId: "42"
							}
						]
					}
				]
			}
		]);

		await expect(processInstallation()(data, sentry, getLogger("test"))).toResolve();
		await verifyMessageSent(data);
	});

	it("should not call Jira if no issue keys are present", async () => {
		const data: BackfillMessagePayload = { installationId, jiraHost };

		githubUserTokenNock(installationId);

		createGitHubNock(deploymentNodesFixture);
		githubNock.get(`/repos/test-repo-owner/test-repo-name/commits/51e16759cdac67b0d2a94e0674c9603b75a840f6`)
			.reply(200, {
				commit: {
					author: {
						name: "test-branch-author-name",
						email: "test-branch-author-name@github.com",
						date: "test-branch-author-date"
					},
					message: "NO SMART COMMITS HERE test-commit-message"
				},
				html_url: `test-repo-url/commits/51e16759cdac67b0d2a94e0674c9603b75a840f6`
			});

		const interceptor = jiraNock.post(/.*/);
		const scope = interceptor.reply(200);

		await expect(processInstallation()(data, sentry, getLogger("test"))).toResolve();
		expect(scope).not.toBeDone();
		removeInterceptor(interceptor);
	});

	it("should not call Jira if no data is returned", async () => {
		const data = { installationId, jiraHost };
		createGitHubNock();

		const interceptor = jiraNock.post(/.*/);
		const scope = interceptor.reply(200);

		await expect(processInstallation()(data, sentry, getLogger("test"))).toResolve();
		expect(scope).not.toBeDone();
		removeInterceptor(interceptor);
	});

});
