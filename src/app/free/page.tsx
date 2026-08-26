import type { Metadata } from "next";
import { FreeBuildClient } from "@/components/free/FreeBuildClient";

export const metadata: Metadata = {
  description:
    "A floor, a box of a couple of hundred LDraw parts, and nothing telling you what to make. Snaps to the stud grid, and exports what you build as an LDraw file.",
  title: "Free build",
};

export default function FreeBuildPage() {
  return <FreeBuildClient />;
}
