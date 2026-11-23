# Maintainer notes

Everything here is about developing and releasing `dsh-a2a-client`. The README
holds user-facing documentation only.

## Working on the code

No dependencies, no build step.

```sh
npm test        # locale + security suites
npm run check   # syntax of both halves
```

`client.js` is the panel (browser half), `index.js` is the Host half with the
tools and the panel API. After editing, restart DSH.

`files` in `package.json` is the whole npm payload: `index.js`, `client.js`,
`cordis.patch.yml`, `locale/*.json`, `icon.svg`, and the three READMEs. Add a new
runtime file to `files` and `exports` together.

`engines.dsh` in `package.json` is checked on install and on profile start. The
range keeps a prerelease comparator (`>=0.2.2-rc.5`) on purpose: plain
`>=0.2.2` does not admit `0.2.2-rc.5`, and the package would reject itself on the
release it was built for.

## Releasing

`.github/workflows/ci.yml` runs `check` and `test` on `main` and on pull
requests. `.github/workflows/release.yml` runs on a `v*` tag and does the whole
release: it refuses a tag that does not match `package.json`, refuses a version
that npm already has, runs both suites, publishes to npm with provenance, and
creates the GitHub Release with generated notes.

```sh
npm version patch --no-git-tag-version   # bump package.json
git commit -am "Версия 1.7.2"
git tag v1.7.2
git push origin main --tags
```

`prepublishOnly` runs `check` and `test` again, so a manual `npm publish` is
equally safe.

### npm authentication

Trusted publishing is configured per package on npmjs.com, so it cannot be set up
before the package exists. For the **first** release add an `NPM_TOKEN`
repository secret — a granular token with publish rights for `dsh-a2a-client`.

Once the package is on npm, switch to a trusted publisher (repository
`ilyshkafox/dsh-a2a-client`, workflow `release.yml`) and delete the secret. The
workflow uses OIDC when `NPM_TOKEN` is absent.

`--provenance` requires a public repository; this one is public, so the npm page
shows the build provenance.
