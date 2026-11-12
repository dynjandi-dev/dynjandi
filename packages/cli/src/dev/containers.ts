import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { RendererStartAborted, runDocker } from "./docker.js";

const LOOPBACK = "127.0.0.1";
// What a container on Docker Desktop calls the host (the VM-based runtimes; plan #43, D3).
const DESKTOP_HOST_NAME = "host.docker.internal";

/**
 * Where `dev --containers` listens, and the name containers reach it by (plan #43, D2, D3). `addresses` always
 * starts with loopback and never holds an unspecified address, which would reach the LAN.
 */
export interface ContainerPlan {
  addresses: string[];
  /** The gateway when this host holds it (Linux Engine), else `host.docker.internal`; an IPv6 one is bracketed. */
  containerHost: string;
}

/** `http://<gateway>:<port>` where the gateway is bound, `http://host.docker.internal:<port>` otherwise (D3). */
export function containerOrigin(plan: ContainerPlan, port: number | string): string {
  return `http://${plan.containerHost}:${port}`;
}

function fail(reason: string): never {
  throw new Error(
    `--containers ${reason}; leave out --containers to run without the container way in`,
  );
}

// One spelling per address, so "::1" and "0:0:0:0:0:0:0:1" compare equal. `URL` is the WHATWG parser; an IPv6
// host comes back bracketed.
function canonical(address: string): string | undefined {
  const family = isIP(address);
  if (family === 0 || address.includes("%")) return undefined;
  try {
    return new URL(family === 6 ? `http://[${address}]` : `http://${address}`).hostname;
  } catch {
    return undefined;
  }
}

// `::` and `0.0.0.0`, and the forms that mean the same: IPv4-mapped (`::ffff:0.0.0.0`).
const UNSPECIFIED = new Set(["0.0.0.0", "[::]", "[::ffff:0:0]"]);

// The first entry of `IPAM.Config` that has a gateway. A user-defined network may have entries without one.
function gatewayOf(inspectOutput: string): unknown {
  let config: unknown;
  try {
    config = JSON.parse(inspectOutput);
  } catch {
    fail(
      "could not read the bridge network from `docker network inspect bridge`: the output is not JSON",
    );
  }
  if (!Array.isArray(config)) {
    fail(
      "could not read the bridge network from `docker network inspect bridge`: it has no IPAM config",
    );
  }
  const entry = config.find(
    (item: unknown): item is { Gateway: unknown } =>
      typeof item === "object" && item !== null && "Gateway" in item && item.Gateway !== undefined,
  );
  if (entry === undefined) {
    fail(
      "could not read the bridge network from `docker network inspect bridge`: no entry has a Gateway",
    );
  }
  return entry.Gateway;
}

/**
 * Turns `docker network inspect bridge --format '{{json .IPAM.Config}}'` and the addresses this host holds into
 * the listen plan. The gateway becomes a second listener only if it is an IP address, not unspecified, and in
 * `localAddresses` (Linux Engine). Otherwise it is a VM-based runtime and loopback is the only listener (D2).
 * Throws an `Error` of one line for anything else.
 */
export function planContainerAccess(
  inspectOutput: string,
  localAddresses: readonly string[],
): ContainerPlan {
  const gateway = gatewayOf(inspectOutput);
  if (typeof gateway !== "string") {
    fail(`could not use the bridge gateway ${JSON.stringify(gateway)}: it is not an IP address`);
  }
  const canonicalGateway = canonical(gateway);
  if (canonicalGateway === undefined) {
    fail(`could not use the bridge gateway ${JSON.stringify(gateway)}: it is not an IP address`);
  }
  if (UNSPECIFIED.has(canonicalGateway)) {
    fail(
      `refuses the bridge gateway ${JSON.stringify(gateway)}: it is the unspecified address, which would listen on every network`,
    );
  }
  const isLocal = localAddresses.some((address) => canonical(address) === canonicalGateway);
  if (!isLocal) return { addresses: [LOOPBACK], containerHost: DESKTOP_HOST_NAME };
  const gatewayText = gateway;
  return {
    addresses: [LOOPBACK, gatewayText],
    containerHost: isIP(gatewayText) === 6 ? `[${gatewayText}]` : gatewayText,
  };
}

function hostAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .map((entry) => entry.address);
}

/**
 * Asks Docker for the default bridge and plans the listeners. `docker` is run with an argument array and no shell
 * (`runDocker`). Throws one line naming `--containers` when `docker` is missing or fails.
 */
export async function readContainerPlan(signal?: AbortSignal): Promise<ContainerPlan> {
  let result: Awaited<ReturnType<typeof runDocker>>;
  try {
    result = await runDocker(
      ["network", "inspect", "bridge", "--format", "{{json .IPAM.Config}}"],
      signal,
    );
  } catch (error) {
    if (error instanceof RendererStartAborted) throw error;
    const cause = error instanceof Error ? error.cause : undefined;
    const missing =
      typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
    // The spawn error itself, not `runDocker`'s message: that one names the renderer's ways round
    // (--renderer-url, --no-renderer), and neither helps --containers, which needs docker in every mode.
    const reason =
      cause instanceof Error
        ? cause.message
        : error instanceof Error
          ? error.message
          : String(error);
    fail(
      missing
        ? "needs docker on PATH to find the bridge gateway (docker was not found on PATH); install Docker and start it"
        : `could not run docker to read the bridge network (${reason})`,
    );
  }
  if (result.code !== 0) {
    const reason =
      result.stderr
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line !== "") ?? `exit code ${result.code}`;
    fail(`could not read the bridge network: docker network inspect bridge failed: ${reason}`);
  }
  return planContainerAccess(result.stdout.trim(), hostAddresses());
}
