# Status and Bananapulse

Status builds its checked-in Astro source for the Node and Netlify adapters.
Bananapulse supplies the native Go monitor, subscriber and credential owners.
The web service connects through its authenticated private owner endpoint.

Build the Go image from the qualified Bananapulse revision with
`deployment/Dockerfile.status-native`. Build the web image from the Status
checkout. Keep the owner token private and use the retained subscriber signing
secret so existing links continue to resolve.

The Status verification workflow checks the checked-in source and builds both
Astro adapters. See the [deployment and differential test
procedures](../deploy/status/README.md) for the owner data export and loopback
parity runs.
