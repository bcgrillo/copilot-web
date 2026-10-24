import { describe, expect, it } from "vitest";
import {
  cleanToolOutput,
  textContentOf,
  textOfParts,
  toolInputDetail,
} from "./content";

describe("textContentOf", () => {
  it("reads text from a single block", () => {
    expect(textContentOf({ type: "text", text: "hi" })).toBe("hi");
  });

  it("joins a flat list of blocks", () => {
    expect(
      textContentOf([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ])
    ).toBe("ab");
  });

  it("unwraps nested { content } blocks (tool_call_update shape)", () => {
    expect(
      textContentOf([{ type: "content", content: { type: "text", text: "out" } }])
    ).toBe("out");
  });

  it("passes through raw strings", () => {
    expect(textContentOf("raw")).toBe("raw");
  });

  it("returns empty string for non-text blocks", () => {
    expect(textContentOf({ type: "image", data: "x" })).toBe("");
    expect(textContentOf(undefined)).toBe("");
  });
});

describe("toolInputDetail", () => {
  it("renders shell commands verbatim", () => {
    expect(
      toolInputDetail({ command: "ls -la" }, undefined)
    ).toBe("$ ls -la");
  });

  it("JSON-slices arbitrary input", () => {
    const detail = toolInputDetail({ path: "/a" }, undefined);
    expect(detail?.startsWith("{")).toBe(true);
    expect(detail).toContain('/a');
  });

  it("falls back to content text", () => {
    expect(toolInputDetail(undefined, [{ type: "text", text: "out" }])).toBe("out");
  });

  it("returns undefined with no input and no content", () => {
    expect(toolInputDetail(undefined, undefined)).toBeUndefined();
  });
});

describe("cleanToolOutput", () => {
  it("strips the shellId tail marker", () => {
    expect(cleanToolOutput("out\nexit 0\n<shellId: abc-123>\n")).toBe("out\nexit 0");
    expect(cleanToolOutput("out<shellId: x>")).toBe("out");
  });

  it("keeps clean output untouched", () => {
    expect(cleanToolOutput("plain")).toBe("plain");
  });
});

describe("textOfParts", () => {
  it("concatenates only text parts", () => {
    expect(
      textOfParts([
        { kind: "text", content: "a" },
        { kind: "reasoning", content: "hidden" },
        { kind: "system", content: "sys" },
        { kind: "text", content: "b" },
      ])
    ).toBe("ab");
  });
});