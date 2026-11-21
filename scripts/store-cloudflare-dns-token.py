#!/usr/bin/env python3
"""Encrypt a DNS token on the laptop; only AI-WORKSPACE can decrypt it."""
import getpass
from pathlib import Path
import shutil
import subprocess
import tempfile
import warnings

RECIPIENT = 'D862B54C6402ADFE4566B705B8B7815A67552C0E'
PUBLIC_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmQGNBGq1nGQBDADdfuyy9c73GE9EQc0LQsb6HpZC9S+V8QYh2zgw4sCBq2Lsuipb\nFY30l5CXFl1du9R6mG9Ohj8QfNk7ziKACwYMVdnXG7ZZT8Hi7ZWAPVA7LNDd/Kh9\nQLNuMHlKaVeLVYKvwBx7jEBDDK3rGKGKzMs6majww0TBwnf5E8upaymrcVTU3bUU\n1RhiwDxr2mP4WgaBzPTsZ9jo5tEvxDw/6u8HZcZlgG7lxnrAW1oWDMVlg66HjGVp\nr5ZqpYBwVY7hAC9kIpa85NBonFLL9lFg9rIeLs3gphUXwSxHWiskpvZ4w/wn4Ex3\noWMZL5TTI66Y+XC9Jt1qFGE+PIlQcoNKSGlcAz/69OtgdKA8njaRfzuV9wZwGGdN\n51zBUAlTZXAg2OroKpjhJ8TQkpiy1vxsHM2wNYDuOospWbwQm07fvSD7FFe4hHYu\n52pJywoN5iZ+CbF8o/OqjfGakf2fhcvOf84EuLUvSAp7dp+CEsxwi2+hn1CbVgGz\nReGVSM+y0bu3EPcAEQEAAbQgU2Vzc2lvbnMgRE5TIGNyZWRlbnRpYWwgdHJhbnNm\nZXKJAdcEEwEKAEEWIQTYYrVMZAKt/kVmtwW4t4FaZ1UsDgUCarWcZAIbDQUJAAKj\nAAULCQgHAgIiAgYVCgkICwIEFgIDAQIeBwIXgAAKCRC4t4FaZ1UsDkw2DACHdd7w\nmy31G4X4xIWMzyqXfXCbkg0Exwo9QyYBRv4YEVKLQYyVhuB8T5bY3fF3gamhNRX9\nOiIVUXK/r6Mi53IC9/uPdLc5Ve55MkHkP22ltlbvCPJ0He2wK7EIedj0o2nO70zN\nk15gBymPKHbJrx7ch+XnYXQ/ynLDFNQHxku3qeY94U+0vouvCsu1P4RQ0KPgQ7a/\n1weqV2Tz6Ix4ej/NfXBZ+xpEB1txSmhllxwwhntzMsZZ9x4aHmreBPwdQjgwjjsZ\nEF/SXMtniaTHKoUVtkNZu2iz1aVSEUZv02AO1CsLhpMWvppoiXuhtiruSv+BqQAa\npf7z0J+pbF8DTzIslLExO9++WpL2jUqmBjUAnNtRDqvL3OWGth1aN7YMcY+5PtDg\nr77i7I8ObzHg3l+mTKo7rqP2H6I2qmK8hDzBuyfq4tFuQ1W6zYQCFArZqRNWrj3v\n8aRISyp+GhJ3KlxGOSfY8neT6ID+tZLksHPTExmR5NkQ+Is7PhbKdmXbKqY=\n=of2a\n-----END PGP PUBLIC KEY BLOCK-----\n'


def encrypt_token(token, output):
    if not shutil.which('gpg'):
        raise SystemExit('Install GnuPG first: sudo apt install gnupg')
    if not token or any(c.isspace() for c in token):
        raise SystemExit('Token was empty or contained whitespace; nothing saved.')
    with tempfile.TemporaryDirectory(prefix='sessions-public-key-') as keyring:
        base = ['gpg', '--homedir', keyring, '--batch', '--quiet']
        subprocess.run(base + ['--import'], input=PUBLIC_KEY.encode(),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        # The plaintext token exists only in memory and the pipe to GnuPG.
        subprocess.run(base + ['--trust-model', 'always', '--armor',
                              '--recipient', RECIPIENT, '--output', str(output), '--encrypt'],
                       input=token.encode(), stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, check=True)


def main():
    warnings.simplefilter('error', getpass.GetPassWarning)
    token = getpass.getpass('Cloudflare DNS token (hidden): ').strip()
    directory = Path.home() / 'Downloads'
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / 'cloudflare-dns-token.asc'
    if output.exists():
        raise SystemExit('An encrypted token file already exists in Downloads; rename it before retrying.')
    try:
        encrypt_token(token, output)
    except subprocess.CalledProcessError:
        raise SystemExit('Encryption failed. No plaintext token was written. Check GnuPG and the key expiry.')
    print('Attach ONLY this encrypted file to the chat:')
    print(output)


if __name__ == '__main__':
    main()
