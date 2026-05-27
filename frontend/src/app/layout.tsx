import type { Metadata } from "next";
import { Rubik, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";

const rubik = Rubik({ variable: "--font-geist-sans", subsets: ["latin"], weight: ["400","500","600","700"] });
const mono  = IBM_Plex_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400","500"] });

export const metadata: Metadata = {
  title: "InfiOps — AI Automation Platform",
  description: "Backup · Monitoring · AI · Containers · DevOps — all in one platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${rubik.variable} ${mono.variable} antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
