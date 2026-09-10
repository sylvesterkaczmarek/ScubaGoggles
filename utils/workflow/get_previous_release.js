module.exports = async ({ github, context, core }) => {
  function parseVersion(tagName) {
    const match = tagName.match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/i);
    if (!match) {
      return null;
    }
  
    return {
      tag: tagName,
      parts: [
        Number(match[1]),
        Number(match[2]),
        Number(match[3] ?? 0)
      ]
    };
  }
  
  function compareVersions(left, right) {
    for (let index = 0; index < 3; index++) {
      if (left.parts[index] !== right.parts[index]) {
        return left.parts[index] - right.parts[index];
      }
    }
    return 0;
  }
  
  const releases = await github.paginate(
    github.rest.repos.listReleases,
    {
      owner: context.repo.owner,
      repo: context.repo.repo,
      per_page: 100
    }
  );
  
  const currentTag = `v${process.env.RELEASE_VERSION}`;
  const currentVersion = parseVersion(currentTag);
  if (!currentVersion) {
    core.setFailed(`Unable to parse release version from tag ${currentTag}.`);
    return;
  }
  
  const publishedReleases = releases
    .filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        release.tag_name.toLowerCase() !== currentTag.toLowerCase()
    )
    .map((release) => ({
      release,
      version: parseVersion(release.tag_name)
    }))
    .filter((entry) => entry.version)
    .filter((entry) => compareVersions(entry.version, currentVersion) < 0)
    .sort((left, right) => compareVersions(right.version, left.version));
  
  const previousEntry = publishedReleases[0];
  if (!previousEntry) {
    core.setFailed(
      `Unable to find a published release older than ${currentTag}.`
    );
    return;
  }
  
  const previousRelease = previousEntry.release;
  core.info(
    `Using previous tag ${previousRelease.tag_name} (published ${previousRelease.published_at}) for release notes.`
  );
  core.setOutput("tag", previousRelease.tag_name);
};
