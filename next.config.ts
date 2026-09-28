import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep the PDF / DOCX parsers as plain Node modules in the serverless bundle.
  serverExternalPackages: ['unpdf', 'mammoth'],
};

export default nextConfig;
