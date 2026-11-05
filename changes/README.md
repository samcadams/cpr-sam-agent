# Changelog fragments

Don't edit `CHANGELOG.md` for a new feature or fix. Add a file here instead, one per feature, named after its
WIP ledger key (`changes/<key>.md`, e.g. `changes/roach-race.md`), holding its changelog bullets:

```
- Roach Race: the 2077 arcade cabinet on the Agent (starts off; switch it on in Control). …
```

Same style as the changelog: `- ` bullets, short and user-facing, the app's name first. Several features
can be written at once without touching the same file.

`npm run changelog` shows what the next fold adds. `npm run changelog -- --write` folds every fragment
into `CHANGELOG.md` under the version in `module.json` (`## V1.2.0`, made if it isn't there), newest
section first, and deletes the fragments. Fold at release time, or when Sam asks.
