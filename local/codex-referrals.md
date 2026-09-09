# Codex referral classification

The live SOSPDF folder action is managed as `soslist-uploader` in `~/Projects/apps.tsv`.
Its source is `/Users/shungohiroyasu/soslist/openai-processor`, **not this repository's older `openai-processor` watcher**. The live importer README documents configuration, dry runs and explicit reclassification.

On new PDF imports, Codex extracts the appointment and identifies each service category using `routing-policy.txt` in that live source directory. Firestore `appointments.referralRouting` contains version 1, provider `codex`, sourceServices/sourceCptCodes, service assignments, destinations, Japanese draft purposes and reviewRequired.

`shared/core.js` uses this routing when the source arrays match the appointment. The existing regex handles records without matching routing. Unknown clinic assignments produce a review notice. Saved referral fields continue to take precedence over generated purposes. `local/script.js` no longer overwrites these purposes a second time after opening the modal.

Pulmonary function tests (PFT/spirometry/flow-volume loops) are onsite and require no referral. Lab is a date-gated tracking row without a letter. Chest X-ray is assigned once according to the existing echo/ECG/orthopedic policy.

Existing records are not bulk reclassified. Public web publication is separate from installing SOSList Local; these shared-source changes alone do not update the deployed public site.

Validation:

```sh
node --test local/tests/referral-routing.test.cjs
# Verify the installed copy after building:
SOSLIST_CORE_TEST_FILE='/Applications/SOSList Local.app/Contents/Resources/local-web/shared/core.js' node --test local/tests/referral-routing.test.cjs
```
