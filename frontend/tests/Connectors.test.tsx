import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { useRef, useEffect, useState } from "react";
import { Connectors } from "../src/viz/Connectors";
import type { MemoryLink } from "../src/viz/memoryModel";

function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON() {} } as DOMRect;
}

function Harness({ links }: { links: MemoryLink[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    el.getBoundingClientRect = () => rect(0, 0, 200, 200);
    const port = el.querySelector('[data-port-id="from"]');
    const target = el.querySelector('[data-cell-id="to"]');
    if (port) port.getBoundingClientRect = () => rect(10, 10, 20, 30);
    if (target) target.getBoundingClientRect = () => rect(120, 40, 180, 60);
    setReady(true);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <span data-port-id="from" />
      <span data-cell-id="to" />
      {ready && <Connectors containerRef={ref} links={links} stepKey={0} />}
    </div>
  );
}

describe("Connectors", () => {
  it("draws one path per resolved link with container-relative coordinates", () => {
    const links: MemoryLink[] = [{ fromId: "from", fromName: "p", toId: "to", targetAddress: "0x1" }];
    const { container } = render(<Harness links={links} />);
    const paths = container.querySelectorAll("path.connector");
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute("d")!.startsWith("M 20 20 C")).toBe(true);
    expect(paths[0].getAttribute("d")).toContain("120 50");
  });

  it("skips links whose endpoints are missing", () => {
    const links: MemoryLink[] = [{ fromId: "nope", fromName: "x", toId: "gone", targetAddress: "0x9" }];
    const { container } = render(<Harness links={links} />);
    expect(container.querySelectorAll("path.connector").length).toBe(0);
  });
});
