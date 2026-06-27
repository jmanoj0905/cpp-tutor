import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef, useEffect, useState } from "react";
import type { RefObject } from "react";
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
      {ready && <Connectors containerRef={ref} links={links} stepKey={0} selected={null} onSelect={() => {}} />}
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

  it("calls onSelect with the link when a connector is clicked", () => {
    const onSelect = vi.fn();
    const containerRef = { current: document.createElement("div") } as RefObject<HTMLDivElement>;
    // a port + a target so measure() produces one path
    const port = document.createElement("div");
    port.setAttribute("data-port-id", "from-1");
    const target = document.createElement("div");
    target.setAttribute("data-cell-id", "to-1");
    containerRef.current.append(port, target);
    document.body.append(containerRef.current);

    const links = [{ fromId: "from-1", fromName: "p", toId: "to-1", targetAddress: "0x1" }];
    const { container } = render(
      <Connectors containerRef={containerRef} links={links} stepKey={1} selected={null} onSelect={onSelect} />,
    );
    const hit = container.querySelector(".connector-hit") as SVGPathElement;
    expect(hit).not.toBeNull();
    fireEvent.click(hit);
    expect(onSelect).toHaveBeenCalledWith({ fromId: "from-1", toId: "to-1" });
  });
});
