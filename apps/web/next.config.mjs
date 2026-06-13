/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@rivlayx/auth', '@rivlayx/db', '@rivlayx/shared'],
};

export default nextConfig;
