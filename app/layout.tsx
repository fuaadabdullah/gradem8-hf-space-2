import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Gradem8 HF Space 2",
  description: "Hugging Face inference demo built with Next.js and server-side token handling.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f3f4f6", color: "#0f172a", fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}>
        {children}
      </body>
    </html>
  );
}
