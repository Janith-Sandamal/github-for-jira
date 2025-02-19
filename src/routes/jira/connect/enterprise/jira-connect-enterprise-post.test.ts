/* eslint-disable @typescript-eslint/no-explicit-any */
import { GitHubServerApp } from "models/github-server-app";
import { JiraConnectEnterprisePost } from "routes/jira/connect/enterprise/jira-connect-enterprise-post";
import { Installation } from "models/installation";
import { v4 as newUUID } from "uuid";

const testSharedSecret = "test-secret";

describe("POST /jira/connect/enterprise", () => {
	let installation;
	const mockRequest = (gheServerURL: string): any => ({
		log: {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn()
		},
		body: { gheServerURL },
		query: {},
		csrfToken: jest.fn().mockReturnValue({})
	});

	const mockResponse = (): any => {
		const response = {
			locals: {
				installation,
				jiraHost
			},
			render: jest.fn().mockReturnValue({}),
			status: jest.fn(),
			send: jest.fn().mockReturnValue({})
		};
		response.status = response.status.mockReturnValue(response);

		return response;
	};

	beforeEach(async () => {
		installation = await Installation.install({
			host: jiraHost,
			sharedSecret: testSharedSecret,
			clientKey: "client-key"
		});
	});

	it("POST Jira Connect Enterprise - invalid URL", async () => {
		const response = mockResponse();
		await JiraConnectEnterprisePost(mockRequest("Random string!!"), response);

		expect(response.status).toHaveBeenCalledWith(200);
		expect(response.send).toHaveBeenCalledWith({ success: false, errors: [{ code: "GHE_ERROR_INVALID_URL", message: "Invalid URL" }] });
	});

	it("POST Jira Connect Enterprise - valid existing URL", async () => {
		await GitHubServerApp.install({
			uuid: newUUID(),
			appId: 1,
			gitHubBaseUrl: gheUrl,
			gitHubClientId: "dragon",
			gitHubClientSecret: "dragon",
			webhookSecret: "dragon",
			privateKey: "dragon",
			gitHubAppName: "Monkey D. Dragon",
			installationId: installation.id
		});

		const response = mockResponse();
		await JiraConnectEnterprisePost(mockRequest(gheUrl), response);

		expect(response.status).toHaveBeenCalledWith(200);
		expect(response.send).toHaveBeenCalledWith({ success: true, appExists: true });
	});

	it("POST Jira Connect Enterprise - valid new URL", async () => {
		const response = mockResponse();
		gheNock.get("/").reply(200);
		await JiraConnectEnterprisePost(mockRequest(gheUrl), response);
		expect(response.status).toHaveBeenCalledWith(200);
		expect(response.send).toHaveBeenCalledWith({ success: true, appExists: false });
	});
});