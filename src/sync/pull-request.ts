import { PullRequestSort, PullRequestState, SortDirection } from "../github/client/github-client.types";
import url from "url";
import { transformPullRequest } from "./transforms/pull-request";
import { statsd }  from "config/statsd";
import { metricHttpRequest } from "config/metric-names";
import { Repository } from "models/subscription";
import { GitHubInstallationClient } from "../github/client/github-installation-client";
import { getGithubUser } from "services/github/user";
import Logger from "bunyan";
import { AxiosResponseHeaders } from "axios";
import { Octokit } from "@octokit/rest";
import { getCloudOrServerFromHost } from "utils/get-cloud-or-server";

/**
 * Find the next page number from the response headers.
 */
export const getNextPage = (logger: Logger, headers: Headers = {}): number | undefined => {
	const nextUrl = ((headers.link || "").match(/<([^>]+)>;\s*rel="next"/) ||
		[])[1];
	if (!nextUrl) {
		return undefined;
	}
	logger.debug("Extracting next PRs page url");
	const parsed = url.parse(nextUrl)?.query?.split("&");
	let nextPage;
	parsed?.forEach((query) => {
		const [key, value] = query.split("=");
		if (key === "page") {
			nextPage = Number(value);
		}
	});
	return nextPage;
};

type Headers = AxiosResponseHeaders & {
	link?: string;
}

type PullRequestWithCursor = { cursor: number } & Octokit.PullsListResponseItem;

export const getPullRequestTask = async (
	logger: Logger,
	newGithub: GitHubInstallationClient,
	_jiraHost: string,
	repository: Repository,
	cursor: string | number = 1,
	perPage?: number
) => {
	logger.info("Syncing PRs: started");

	cursor = Number(cursor);
	const startTime = Date.now();

	const {
		data: edges,
		status,
		headers,
		request
	} =	await newGithub
		.getPullRequests(repository.owner.login, repository.name,
			{
				per_page: perPage,
				page: cursor,
				state: PullRequestState.ALL,
				sort: PullRequestSort.CREATED,
				direction: SortDirection.DES
			});

	const gitHubProduct = getCloudOrServerFromHost(request.host);
	statsd.timing(
		metricHttpRequest.syncPullRequest,
		Date.now() - startTime,
		1,
		[`status:${status}`, `gitHubProduct: ${gitHubProduct}`]);

	// Force us to go to a non-existant page if we're past the max number of pages
	const nextPage = getNextPage(logger, headers) || cursor + 1;

	// Attach the "cursor" (next page number) to each edge, because the function that uses this data
	// fetches the cursor from one of the edges instead of letting us return it explicitly.
	const edgesWithCursor: PullRequestWithCursor[] = edges.map((edge) => ({ ...edge, cursor: nextPage }));

	// TODO: change this to reduce
	const pullRequests = (
		await Promise.all(
			edgesWithCursor.map(async (pull) => {
				const prResponse = await newGithub.getPullRequest(repository.owner.login, repository.name, pull.number);
				const prDetails = prResponse?.data;
				const ghUser = await getGithubUser(newGithub, prDetails?.user.login
				);
				const data = await transformPullRequest(
					{ pullRequest: pull, repository },
					prDetails,
					ghUser
				);
				return data?.pullRequests[0];
			})
		)
	).filter((value) => !!value);

	logger.info("Syncing PRs: finished");

	return {
		edges: edgesWithCursor,
		jiraPayload:
			pullRequests?.length
				? {
					id: repository.id.toString(),
					name: repository.full_name,
					pullRequests,
					url: repository.html_url,
					updateSequenceId: Date.now()
				}
				: undefined
	};
};
