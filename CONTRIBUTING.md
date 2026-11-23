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
requests.

A **GitHub Release** publishes to npm — not a tag push. The release is the one
act that ships, so what reaches npm is always what was released. Publishing a
release for tag `v1.7.2` runs `.github/workflows/release.yml`, which checks the
tag against `package.json`, runs both suites, skips a version npm already has,
publishes, and prints what npm now serves.

```sh
npm version patch --no-git-tag-version   # bump package.json
git commit -am "Версия 1.7.2"
git push origin main
git tag v1.7.2
git push origin v1.7.2
gh release create v1.7.2 --generate-notes   # this publishes
```

A prerelease version (`1.8.0-rc.1`) goes out under the `next` dist-tag, so it
never takes over `latest`, which is what `dsh plugin add` installs.

`prepublishOnly` runs `check` and `test` again, so a manual `npm publish` is
equally safe.

### npm authentication

The workflow uses npm trusted publishing (OIDC) — there is no `NPM_TOKEN`
secret. The trust is configured once, and it needs the package to exist:

```sh
npm trust github dsh-a2a-client --file release.yml --repo ilyshkafox/dsh-a2a-client
```

`npm trust list dsh-a2a-client` shows what is configured. If the package is ever
recreated, the trust goes with it and has to be granted again.

`npm publish` attaches provenance automatically on a public repository, so the
npm page shows the build provenance.
