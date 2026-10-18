# Volanea Send Email — GitHub Action

Send an email through [Volanea](https://volanea.com) from any workflow: release notes,
deploy alerts, nightly reports, failed-build pings.

```yaml
- uses: Pankaj-bit361/volanea-send-email@v1
  with:
    api-key: ${{ secrets.VOLANEA_API_KEY }}
    from: releases@yourdomain.com
    to: team@yourdomain.com
    subject: "Released ${{ github.ref_name }}"
    html: "<p>${{ github.repository }} ${{ github.ref_name }} is live.</p>"
```

With a saved template:

```yaml
- uses: Pankaj-bit361/volanea-send-email@v1
  with:
    api-key: ${{ secrets.VOLANEA_API_KEY }}
    to: oncall@yourdomain.com
    template-id: tmpl-…
    variables: '{"service": "api", "status": "${{ job.status }}"}'
```

## Inputs

| Input | Required | |
| --- | --- | --- |
| `api-key` | yes | A Volanea secret key, from a repository secret. It is masked in the log. |
| `to` | yes | One address, or several separated by commas or newlines (each gets its own copy, up to 50). |
| `from` | | On a domain verified in Volanea. Optional when the template has a sender. |
| `from-name` | | Sender display name. |
| `subject` | | Required unless the template provides one. |
| `html` / `text` / `template-id` | one of them | The body. |
| `variables` | | JSON object for `{{placeholders}}`. |
| `reply-to` | | Reply-To address. |
| `idempotency-key` | | Defaults to the run id, attempt and job, so re-running a job does not send twice. |

## Outputs

`email-id` (the first message) and `email-ids` (a JSON array of all of them).

The step fails with the API's reason when Volanea rejects the send (for example an
unverified sender domain), and when every recipient was skipped.

## License

MIT
