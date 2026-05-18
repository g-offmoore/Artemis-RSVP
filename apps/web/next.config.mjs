import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot
  },
  images: {
    unoptimized: true
  },
  poweredByHeader: false
};

export default nextConfig;
