# Docker Rules

## Image
- Multi-stage builds: `builder` for deps/compile, slim `runtime` for the final image.
- Pin base images by version tag (ideally `@sha256:` digest). Never `latest`.
  Examples: `python:3.12-slim`, `node:20.11-alpine`.
- Run as a non-root user. Create one in the Dockerfile, `USER` it before `CMD`.
- Layer order by change frequency: system deps → language deps → source.
- `CMD` in exec form: `CMD ["python", "-m", "app"]`. Never shell form (breaks signal handling).
- `HEALTHCHECK` on every long-running service.
- `EXPOSE` for documentation; bind ports explicitly in compose.

## Files
- Every service: `Dockerfile` at its root.
- Multi-service repos: `docker-compose.yml` at repo root.
- Always include `.dockerignore`. Minimum:
  ```
  .git
  .venv
  node_modules
  __pycache__
  .env
  dist
  build
  *.log
  ```

## Secrets
- Never `COPY .env`. Never bake secrets into images.
- Pass via runtime env vars or mounted files (compose `env_file:` / `secrets:`).
- `.env` stays in `.gitignore` and `.dockerignore`.

## Hard Rules
- No `latest` tags.
- No root `USER`.
- No secrets in image layers.
- No shell-form `CMD` / `ENTRYPOINT`.
- No build tools in the runtime stage.