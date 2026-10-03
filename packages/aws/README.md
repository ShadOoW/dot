# aws

The AWS CLI's profiles. Only `~/.aws/config` is linked: it names accounts, roles and the
Identity Center to sign in through, and holds no secret.

## Load-bearing

- **`bruce`** is the profile `brucelee` runs the sms and its AWS commands under. The sms is
  started with `AWS_PROFILE=bruce` and no keys; its AWS SDK reads the sign-in cache and renews
  the role's credentials itself, so a running server outlives any one set of keys.
- **`~/.aws/sso/cache` is not in this package and must never be.** `aws sso login` writes the
  sign-in tokens there; they are secrets and per-machine.
- `~/.aws` stays a real directory, so the CLI can create `sso/cache` beside the link.

## Signing in

    aws sso login --profile bruce

Opens a browser tab on the Identity Center page; approve it. The sign-in lasts as long as
the company's Identity Center session, then `brucelee dev sms` asks for it again.
