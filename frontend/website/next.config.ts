/**
 * @file next.config.ts
 * @description Static export (plain HTML/JS/CSS in out/) so the site can be hosted on any static host.
 * @author Reborn1987
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
