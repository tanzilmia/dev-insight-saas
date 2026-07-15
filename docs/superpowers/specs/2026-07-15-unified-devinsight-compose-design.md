# Unified DevInsight Compose Project Design

Date: 2026-07-15

## Goal

Place the running OpenClaw gateway under the `devinsight` project in Docker Desktop
without moving or copying the OpenClaw source, state, configuration, or secrets. Establish
one Compose entry point that can later own the DevInsight web, API, MCP, RADIUS, and other
runtime services.

## Current State

Two independent Compose projects are running:

- `devinsight`, defined by `docker-compose.sonar.yml`, owns SonarQube and its PostgreSQL
  database; and
- `openclaw`, defined by `../openclaw/docker-compose.yml`, owns the OpenClaw gateway.

Docker Desktop groups containers by the Compose project label. The physical repository
location does not determine the group.

## Chosen Architecture

Add a root `compose.yml` with the explicit project name `devinsight`. It will use Compose's
`include` feature to import:

1. the existing `docker-compose.sonar.yml`; and
2. the sibling OpenClaw repository's `docker-compose.yml`.

The OpenClaw include will retain `../openclaw` as its project directory and will use
`../openclaw/.env` for interpolation. This preserves OpenClaw's existing relative build
paths, bind mounts, environment, gateway token, provider credentials, and ignored secret
files. DevInsight will not copy or commit those values.

The root file becomes the authoritative local Docker entry point. Future services can be
defined directly in it or included from focused Compose files while sharing the same
`devinsight` project.

## Lifecycle Commands

The default start workflow will explicitly select these long-running services:

- `sonar_db`;
- `sonarqube`; and
- `openclaw-gateway`.

Explicit selection prevents `openclaw-cli`, an interactive helper service, from being
started as a permanent container. CLI operations will continue to use one-off Compose
`run --rm openclaw-cli ...` commands through the unified root configuration.

Root package scripts will provide memorable commands for starting, stopping, viewing
status, and invoking the OpenClaw CLI. Documentation will identify the root Compose file
as the normal day-to-day interface.

## Migration of the Running Gateway

Changing a container's Compose project label requires container recreation. The migration
will:

1. validate the fully resolved unified Compose model;
2. stop and remove only the old `openclaw` project's gateway container;
3. start the selected services through the new `devinsight` root project; and
4. verify container labels, Docker Compose project status, and the gateway health endpoint.

OpenClaw state is stored in host bind mounts, so recreating the container does not delete
agent configuration, workspace data, MCP registration, or provider credentials. SonarQube
named volumes will remain untouched. No `down -v` or other destructive volume operation
will be used.

The gateway will be briefly unavailable during recreation. Its published ports and
service behavior remain unchanged.

## Failure Handling

- Compose configuration validation must succeed before the old gateway is stopped.
- If the unified gateway does not become healthy, inspect its logs and resolved mounts
  before making further changes; the existing host state remains intact.
- The migration must not print the contents of `../openclaw/.env` or any resolved secret.
- The old project is removed only after configuration validation, avoiding unnecessary
  downtime for a malformed root file.

## Verification

Verification will confirm:

- `docker compose config --services` resolves both Sonar services and both OpenClaw
  service definitions;
- only the three intended long-running services are started;
- Docker Compose reports one running project named `devinsight`;
- the OpenClaw gateway container has `com.docker.compose.project=devinsight`;
- `http://127.0.0.1:18789/healthz` returns successfully;
- SonarQube and its database remain running; and
- `openclaw-cli` remains available for one-off commands but is not a permanent container.

## Non-goals

- Moving the OpenClaw repository into DevInsight.
- Copying or modifying OpenClaw's upstream Compose service definition.
- Moving OpenClaw secrets or persistent state into the DevInsight repository.
- Containerizing the DevInsight web, API, MCP, or RADIUS services in this change.
- Changing ports, application networking, authentication, or production deployment.
