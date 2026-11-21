# Self-hosted Status

Current architecture and operating instructions are in [deploy/status/README.md](deploy/status/README.md).
The frontend remains Astro with Node and Netlify adapters. Go is the single backend
state authority; the frontend receives no PostgreSQL credentials. Keep local
qualification delivery disabled and do not treat this document as deployment authorization.

The original dated planning document is preserved byte-for-byte in the private
migration reference archive. Current cache and scheduler behavior is defined by
middleware.ts and scheduler.ts and covered by the current application tests.
