const nextConfig = {
  // Keep Codex on the native Node resolution path so CLI binary lookup
  // happens on the deployment host instead of being baked into the bundle.
  serverExternalPackages: ["@openai/codex-sdk", "@openai/codex"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
