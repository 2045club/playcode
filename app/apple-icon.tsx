import { ImageResponse } from "next/og";
import { Code2 } from "lucide-react";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#070d24",
          borderRadius: 45,
          color: "#ffffff",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <Code2 size={96} strokeWidth={2} />
      </div>
    ),
    size,
  );
}
