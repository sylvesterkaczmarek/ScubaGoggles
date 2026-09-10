module.exports = async ({ github, context, core }) => {
  const fs = require("fs");
  const path = require("path");
  
  const excludedLabels = new Set([
    "epic",
    "testing",
    "hands-on-prototyping",
    "blocked",
    "duplicate",
    "wontfix"
  ]);
  const sectionOrder = [
    "Major Changes",
    "Bugs Fixed",
    "Baselines",
    "Documentation",
    "Dependencies",
    "Uncategorized changes"
  ];
  
  function isDependencyPullRequest(pr) {
    const dependencyAuthors = new Set([
      "github-actions[bot]",
      "dependabot[bot]"
    ]);
    return (
      dependencyAuthors.has(pr.user.login) ||
      /^Bump /i.test(pr.title)
    );
  }
  
  function hasExcludedLabel(names) {
    return names.some((name) => excludedLabels.has(name));
  }
  
  function getPullRequestLabelNames(pr) {
    return (pr.labels || []).map((label) => label.name);
  }
  
  function sectionFromLabelNames(names) {
    if (names.includes("baseline-document")) {
      return "Baselines";
    }
    if (names.includes("documentation")) {
      return "Documentation";
    }
    if (names.includes("bug")) {
      return "Bugs Fixed";
    }
    if (names.includes("enhancement")) {
      return "Major Changes";
    }
    return null;
  }
  
  async function getClosingIssueLabelNames(prNumber) {
    const query = `
      query ($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            closingIssuesReferences(first: 20) {
              nodes {
                number
                labels(first: 20) {
                  nodes { name }
                }
              }
            }
          }
        }
      }
    `;
    const result = await github.graphql(query, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      number: prNumber
    });
    const issues =
      result.repository.pullRequest.closingIssuesReferences.nodes;
    const names = new Set();
    for (const issue of issues) {
      for (const label of issue.labels.nodes) {
        names.add(label.name);
      }
    }
    return {
      issueNumbers: issues.map((issue) => issue.number),
      labelNames: [...names]
    };
  }
  
  async function categorize(pr) {
    const { issueNumbers, labelNames: issueLabelNames } =
      await getClosingIssueLabelNames(pr.number);
    const prLabelNames = getPullRequestLabelNames(pr);
  
    let labelNames = issueLabelNames;
    let labelSource = "closing issues";
  
    if (issueNumbers.length === 0) {
      labelNames = prLabelNames;
      labelSource = "pull request";
      if (prLabelNames.length > 0) {
        core.info(
          `PR #${pr.number} has no closing issues; using PR labels ` +
            `(${labelNames.join(", ")}).`
        );
      }
    }
  
    if (hasExcludedLabel(labelNames)) {
      core.info(
        `PR #${pr.number} excluded via ${labelSource} labels ` +
          `(${labelNames.join(", ")}).`
      );
      return null;
    }
  
    if (isDependencyPullRequest(pr)) {
      return "Dependencies";
    }
  
    let section = sectionFromLabelNames(labelNames);
  
    if (
      !section &&
      issueNumbers.length > 0 &&
      prLabelNames.length > 0 &&
      !hasExcludedLabel(prLabelNames)
    ) {
      section = sectionFromLabelNames(prLabelNames);
      if (section) {
        core.info(
          `PR #${pr.number} categorized from PR labels after closing ` +
            "issues lacked categorizing labels."
        );
      }
    }
  
    if (!section) {
      core.warning(
        `PR #${pr.number} could not be categorized from ${labelSource} ` +
          `labels (${labelNames.join(", ") || "none"}); including in ` +
          "Uncategorized changes."
      );
      return "Uncategorized changes";
    }
  
    return section;
  }
  
  function formatPullRequest(pr) {
    return `* ${pr.title} by @${pr.user.login} in #${pr.number}`;
  }
  
  function buildIssuesUrl(query) {
    return (
      `https://github.com/${context.repo.owner}/${context.repo.repo}/issues?q=` +
      encodeURIComponent(query)
    );
  }
  
  const sectionFooters = {
    "Major Changes": {
      linkLabel: "enhancements",
      query:
        "is:issue is:closed label:enhancement -label:baseline-document -label:documentation -label:testing -label:hands-on-prototyping -label:epic"
    },
    "Bugs Fixed": {
      linkLabel: "bug fixes",
      query:
        "is:issue is:closed label:bug -label:baseline-document -label:testing -label:documentation -label:epic"
    },
    Documentation: {
      linkLabel: "documentation updates",
      query: "state:closed label:documentation"
    }
  };
  
  function formatSection(title, items) {
    const lines = [`## ${title}`, "", ...items];
    const footer = sectionFooters[title];
    if (footer) {
      lines.push(
        `* See full list of ${footer.linkLabel} [here](${buildIssuesUrl(footer.query)})`
      );
    }
    return `${lines.join("\r\n")}\r\n`;
  }
  
  const bodConfigurationsUrl =
    "https://www.cisa.gov/resources-tools/services/bod-25-01-implementing-secure-practices-cloud-services-required-configurations";
  
  function formatBaselinesSection(baselineItems) {
    const baselineIssuesUrl = buildIssuesUrl(
      "is:issue is:closed label:baseline-document -label:testing -label:documentation -label:epic"
    );
  
    const lines = [
      "## Baselines",
      "",
      "### BOD 25-01 required configuration policy changes",
      "",
      "This section lists baseline policy changes that affect current " +
        `[BOD 25-01 Required Configurations](${bodConfigurationsUrl}).`,
      "",
      "#### Additions",
      "",
      "No new required configuration policies added in this release.",
      "",
      "#### Removals",
      "",
      "_Move BOD 25-01 policy removals here before publishing._",
      "",
      "#### Updates",
      "",
      "_Move BOD 25-01 policy version updates here before publishing._",
      "",
      "### Other baseline changes",
      ""
    ];
  
    if (baselineItems.length > 0) {
      lines.push(...baselineItems);
    } else {
      lines.push("No baseline updates included in this release.");
    }
  
    lines.push(
      `* See full list of baseline updates [here](${baselineIssuesUrl})`
    );
  
    return `${lines.join("\r\n")}\r\n`;
  }
  
  function formatDependenciesSection(items) {
    const dependencyIssuesUrl = buildIssuesUrl(
      'is:pr is:merged label:"version bump"'
    );
    const lines = ["## Dependencies", ""];
    if (items.length > 0) {
      lines.push(...items);
    } else {
      lines.push("No dependency updates included in this release.");
    }
    lines.push(
      `* See full list of dependency updates [here](${dependencyIssuesUrl})`
    );
    return `${lines.join("\r\n")}\r\n`;
  }
  
  function formatUncategorizedSection(items) {
    const lines = [
      "## Uncategorized changes",
      "",
      "The following merged pull requests could not be categorized " +
        "automatically. Review and move them to the appropriate section " +
        "before publishing.",
      "",
      ...items
    ];
    return `${lines.join("\r\n")}\r\n`;
  }
  
  async function listComparisonCommits(basehead) {
    const commits = [];
    let page = 1;
    const perPage = 100;
    let totalCommits = null;
    let status = null;
  
    while (true) {
      const { data: comparison } =
        await github.rest.repos.compareCommitsWithBasehead({
          owner: context.repo.owner,
          repo: context.repo.repo,
          basehead,
          per_page: perPage,
          page
        });
  
      if (page === 1) {
        totalCommits = comparison.total_commits;
        status = comparison.status;
        core.info(
          `Comparing ${basehead}: ${totalCommits} total commits ` +
            `(status: ${status}).`
        );
      }
  
      commits.push(...comparison.commits);
  
      if (comparison.commits.length < perPage) {
        break;
      }
      page += 1;
    }
  
    if (totalCommits !== null && commits.length < totalCommits) {
      core.setFailed(
        `Comparison pagination collected ${commits.length} of ` +
          `${totalCommits} commits for ${basehead}; release notes would ` +
          "be incomplete."
      );
    }
  
    core.info(
      `Collected ${commits.length} commits across ${page} comparison page(s).`
    );
  
    return commits;
  }
  
  async function resolveTagCommitSha(tagName) {
    const { data: ref } = await github.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `tags/${tagName}`
    });
  
    if (ref.object.type === "commit") {
      return ref.object.sha;
    }
  
    const { data: tag } = await github.rest.git.getTag({
      owner: context.repo.owner,
      repo: context.repo.repo,
      tag_sha: ref.object.sha
    });
  
    return tag.object.sha;
  }
  
  async function resolveCompareHeadRef(currentTag, compareHeadRefInput) {
    if (compareHeadRefInput) {
      return compareHeadRefInput;
    }
  
    try {
      await resolveTagCommitSha(currentTag);
      core.info(
        `Tag ${currentTag} already exists; using it as the compare head for release notes.`
      );
      return currentTag;
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }
  
    core.info(
      `Tag ${currentTag} does not exist yet (expected before publish). ` +
        `Using commit ${context.sha} as the compare head.`
    );
    return context.sha;
  }
  
  async function listMergedPullRequests(previousTag, currentTag, compareHeadRefInput) {
    const headRef = await resolveCompareHeadRef(
      currentTag,
      compareHeadRefInput
    );
    const basehead = `${previousTag}...${headRef}`;
    const pullRequestsByNumber = new Map();
  
    const commits = await listComparisonCommits(basehead);
  
    for (const commit of commits) {
      const { data: pulls } =
        await github.rest.repos.listPullRequestsAssociatedWithCommit({
          owner: context.repo.owner,
          repo: context.repo.repo,
          commit_sha: commit.sha
        });
  
      for (const pr of pulls) {
        if (pr.merged_at) {
          pullRequestsByNumber.set(pr.number, pr);
        }
      }
    }
  
    core.info(
      `Found ${pullRequestsByNumber.size} pull requests associated with commits in ${basehead}.`
    );
  
    return { pullRequestsByNumber, headRef, basehead };
  }
  
  const tagName = `v${process.env.RELEASE_VERSION}`;
  const previousTag = process.env.PREVIOUS_RELEASE_TAG;
  const compareHeadRefInput = (process.env.COMPARE_HEAD_REF || "").trim();
  const { pullRequestsByNumber, headRef, basehead } =
    await listMergedPullRequests(
      previousTag,
      tagName,
      compareHeadRefInput
    );
  const grouped = Object.fromEntries(
    sectionOrder.map((title) => [title, []])
  );
  
  let categorizedCount = 0;
  let excludedCount = 0;
  for (const pr of pullRequestsByNumber.values()) {
    const section = await categorize(pr);
    if (section) {
      grouped[section].push(formatPullRequest(pr));
      categorizedCount += 1;
    } else {
      excludedCount += 1;
    }
  }
  
  const sections = sectionOrder
    .filter(
      (title) =>
        title === "Baselines" ||
        title === "Dependencies" ||
        grouped[title].length > 0
    )
    .map((title) => {
      if (title === "Baselines") {
        return formatBaselinesSection(grouped.Baselines);
      }
      if (title === "Dependencies") {
        return formatDependenciesSection(grouped.Dependencies);
      }
      if (title === "Uncategorized changes") {
        return formatUncategorizedSection(grouped["Uncategorized changes"]);
      }
      return formatSection(title, grouped[title]);
    });
  
  const compareUrl = `${process.env.GITHUB_SERVER_URL}/${context.repo.owner}/${context.repo.repo}/compare/${basehead}`;
  const body = `${sections.join("\r\n")}\r\n**Full Changelog**: ${compareUrl}\r\n`;
  
  fs.writeFileSync(path.join(process.cwd(), "release-body.md"), body, "utf8");
  
  const dependencyCount = grouped.Dependencies.length;
  const uncategorizedCount = grouped["Uncategorized changes"].length;
  core.info(
    `Release notes include ${categorizedCount} categorized pull requests ` +
      `(${dependencyCount} in Dependencies, ${uncategorizedCount} uncategorized, ` +
      `${excludedCount} excluded).`
  );
  if (uncategorizedCount > 0) {
    core.warning(
      `${uncategorizedCount} pull request(s) were placed in Uncategorized ` +
        "changes; review and move them before publishing."
    );
  }
  if (dependencyCount === 0) {
    core.warning(
      `No dependency pull requests were linked to commits in ${basehead}. ` +
        "Cherry-picked changes may need to be added manually."
    );
  }
};
