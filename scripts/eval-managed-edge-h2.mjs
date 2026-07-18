#!/usr/bin/env node
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const binaryRoot = path.resolve(process.argv[2] || path.join(root, "target/debug"));
const registry = JSON.parse(fs.readFileSync(path.join(root, "contracts/driver-profiles.json")));
const profiles = registry.profiles.map((profile) => ({
  ...(profile.template ? registry.templates[profile.template] : {}),
  ...profile,
}));

async function evaluate(profile) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), `cowd-edge-${profile.id}-`));
  const socket = path.join(runtime, "edge.sock");
  const credential = path.join(runtime, "credential");
  const token = "eval-token-" + crypto.randomUUID() + crypto.randomUUID();
  fs.writeFileSync(credential, token, { mode: 0o600 });
  const binary = path.join(binaryRoot, profile.artifact);
  const child = spawn(binary, ["--socket", socket, "--credential-file", credential], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8192); });
  try {
    for (let attempt = 0; attempt < 800 && !fs.existsSync(socket); attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${profile.id} exited: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!fs.existsSync(socket)) throw new Error(`${profile.id} did not create UDS: ${stderr}`);
    const client = http2.connect("http://cowd-edge", {
      createConnection: () => net.connect(socket),
    });
    const request = (method, requestPath, value) => new Promise((resolve, reject) => {
      const stream = client.request({
        ":method": method,
        ":path": requestPath,
        "content-type": "application/json",
        "x-cowd-edge-token": token,
      }, { endStream: value === undefined });
      const chunks = [];
      let status = 0;
      stream.on("response", (headers) => { status = headers[":status"]; });
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (status < 200 || status >= 300) return reject(new Error(`${profile.id} ${status}: ${body}`));
        resolve(JSON.parse(body));
      });
      if (value !== undefined) stream.end(JSON.stringify(value));
    });
    try {
      const bootstrap = await request("POST", "/_cowd/edge/v2/handshake", {
        protocol: "cowd.edge.v2",
        gateway_version: "eval",
        surface_id: profile.surface_id,
        driver_profile: profile.id,
        capabilities: profile.capabilities,
      });
      const started = process.hrtime.bigint();
      const replies = await Promise.all(Array.from({ length: 8 }, (_, index) => request(
        "GET",
        "/_cowd/edge/v2/health",
        { type: "health", id: `${profile.id}-health-${index}`, surface: profile.surface_id },
      )));
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (replies.some((reply) => reply.type !== "ok")) throw new Error(`${profile.id} health mismatch`);
      if (bootstrap.surface_id !== profile.surface_id || bootstrap.driver_profile !== profile.id) {
        throw new Error(`${profile.id} bootstrap identity mismatch`);
      }
      if (fs.existsSync(credential)) throw new Error(`${profile.id} credential was not consumed`);
      const mode = fs.statSync(socket).mode & 0o777;
      if (mode !== 0o600) throw new Error(`${profile.id} socket mode ${mode.toString(8)}`);
      return {
        profile: profile.id,
        surface: profile.surface_id,
        artifact: profile.artifact,
        concurrent_health: replies.length,
        elapsed_ms: Number(elapsedMs.toFixed(3)),
      };
    } finally {
      client.close();
    }
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(runtime, { recursive: true, force: true });
  }
}

const results = await Promise.all(profiles.map(evaluate));
const artifacts = [...new Set(results.map((row) => row.artifact))].sort();
if (results.length !== 9 || artifacts.length !== 6) {
  throw new Error(`unexpected matrix: profiles=${results.length}, artifacts=${artifacts.length}`);
}
console.log(JSON.stringify({
  status: "pass",
  protocol: "cowd.edge.v2",
  logical_profiles: results.length,
  unique_artifacts: artifacts.length,
  simultaneous_processes: results.length,
  total_concurrent_health_requests: results.length * 8,
  credential_consumed: true,
  socket_mode: "0600",
  results,
}, null, 2));
