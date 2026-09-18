"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./assistant-avatar.module.css";

export type AssistantAvatarStatus = "idle" | "thinking" | "speaking" | "error";

const descriptions: Record<AssistantAvatarStatus, string> = {
  idle: "相談を待つアトリエの3Dアシスタント",
  thinking: "考え中のアトリエの3Dアシスタント",
  speaking: "返答中のアトリエの3Dアシスタント",
  error: "返答をお休みしているアトリエの3Dアシスタント",
};

/** Decorative sculpture: the chat itself remains the accessible source of conversation. */
export function AssistantAvatar({ status = "idle", className = "" }: {
  status?: AssistantAvatarStatus;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  const redrawRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    statusRef.current = status;
    redrawRef.current?.();
  }, [status]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let release: (() => void) | undefined;

    // Keep WebGL and the rendering library out of the server and initial chat bundle.
    void import("three").then((THREE) => {
      if (cancelled) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      } catch {
        return; // The HTML sculpture remains visible if WebGL is unavailable.
      }
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
      camera.position.set(0, 0.45, 6.5);
      camera.lookAt(0, 0.12, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute("aria-hidden", "true");
      host.appendChild(renderer.domElement);

      const ivory = new THREE.MeshStandardMaterial({ color: 0xf4f0df, roughness: 0.37, metalness: 0.12 });
      const green = new THREE.MeshStandardMaterial({ color: 0x244e40, roughness: 0.4, metalness: 0.22 });
      const brass = new THREE.MeshStandardMaterial({ color: 0xcba86a, roughness: 0.28, metalness: 0.65 });
      const glow = new THREE.MeshStandardMaterial({ color: 0xedf4c5, emissive: 0xbcd998, emissiveIntensity: 0.7, roughness: 0.3 });
      const ink = new THREE.MeshStandardMaterial({ color: 0x152d28, roughness: 0.7 });
      const materials = [ivory, green, brass, glow, ink];
      const geometries: InstanceType<typeof THREE.BufferGeometry>[] = [];
      const sphere = (radius: number) => {
        const geometry = new THREE.SphereGeometry(radius, 24, 16);
        geometries.push(geometry);
        return geometry;
      };
      const robot = new THREE.Group();
      scene.add(robot);
      const body = new THREE.Mesh(sphere(0.56), ivory);
      body.position.y = -0.44;
      body.scale.set(0.85, 1, 0.75);
      robot.add(body);
      const badge = new THREE.Mesh(sphere(0.12), brass);
      badge.position.set(0, -0.36, 0.407);
      badge.scale.z = 0.25;
      robot.add(badge);

      const head = new THREE.Group();
      head.position.y = 0.49;
      robot.add(head);
      const shell = new THREE.Mesh(sphere(0.74), ivory);
      shell.scale.set(1, 0.88, 0.77);
      head.add(shell);
      const visor = new THREE.Mesh(sphere(0.61), green);
      visor.position.set(0, -0.01, 0.285);
      visor.scale.set(1, 0.72, 0.52);
      head.add(visor);
      const eyes = [-1, 1].map((side) => {
        const eye = new THREE.Mesh(sphere(0.073), glow);
        eye.position.set(side * 0.215, 0.08, 0.584);
        eye.scale.set(0.78, 1.2, 0.42);
        head.add(eye);
        const ear = new THREE.Mesh(sphere(0.13), brass);
        ear.position.set(side * 0.72, 0, 0);
        ear.scale.set(0.52, 1, 1);
        head.add(ear);
        return eye;
      });
      const mouth = new THREE.Mesh(sphere(0.08), glow);
      mouth.position.set(0, -0.16, 0.594);
      mouth.scale.set(1, 0.22, 0.25);
      head.add(mouth);

      const arms = [-1, 1].map((side) => {
        const arm = new THREE.Group();
        arm.position.set(side * 0.53, -0.29, 0);
        const hand = new THREE.Mesh(sphere(0.17), ivory);
        hand.position.set(side * 0.05, -0.15, 0.06);
        hand.scale.set(0.85, 1.6, 0.9);
        arm.add(hand);
        robot.add(arm);
        return arm;
      });
      // A small brass painter's brush gives the assistant an atelier identity.
      const brush = new THREE.Group();
      const handleGeometry = new THREE.CylinderGeometry(0.025, 0.035, 0.58, 12);
      const tipGeometry = new THREE.ConeGeometry(0.07, 0.2, 12);
      geometries.push(handleGeometry, tipGeometry);
      const handle = new THREE.Mesh(handleGeometry, brass);
      const tip = new THREE.Mesh(tipGeometry, green);
      tip.position.y = 0.37;
      brush.add(handle, tip);
      brush.position.set(0.13, 0.01, 0.15);
      brush.rotation.z = -0.3;
      arms[1].add(brush);

      const haloGeometry = new THREE.TorusGeometry(0.99, 0.015, 8, 64);
      geometries.push(haloGeometry);
      const halo = new THREE.Mesh(haloGeometry, brass);
      halo.position.set(0, 0.44, -0.4);
      halo.rotation.x = 0.18;
      scene.add(halo);
      scene.add(new THREE.HemisphereLight(0xfffaf0, 0x84998b, 3));
      const key = new THREE.DirectionalLight(0xfff4dd, 4);
      key.position.set(-3, 4, 5);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xd1eee4, 2);
      rim.position.set(3, 1, -2);
      scene.add(rim);

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let visible = true;
      let lost = false;
      let frame = 0;
      let lastFrame = 0;
      const render = (time = 0) => {
        const still = reducedMotion.matches;
        const t = still ? 0 : time / 1000;
        const current = statusRef.current;
        const speaking = current === "speaking";
        const thinking = current === "thinking";
        robot.position.y = still ? 0 : Math.sin(t * 1.8) * 0.035;
        robot.rotation.y = thinking ? -0.16 : Math.sin(t * 0.65) * 0.07;
        head.rotation.z = thinking ? -0.12 : current === "error" ? 0.12 : Math.sin(t * 1.2) * 0.025;
        head.rotation.x = speaking ? Math.sin(t * 5) * 0.035 : 0;
        mouth.scale.y = speaking ? (still ? 0.7 : 0.35 + Math.abs(Math.sin(t * 12)) * 0.85) : 0.22;
        const blink = !still && t % 5.3 > 5.13 ? 0.14 : 1.2;
        eyes.forEach((eye) => { eye.scale.y = thinking ? 0.65 : blink; });
        arms[0].rotation.z = speaking ? -0.15 + Math.sin(t * 3) * 0.1 : -0.05;
        arms[1].rotation.z = thinking ? 0.5 : speaking ? 0.18 + Math.sin(t * 2.5) * 0.1 : 0.05;
        halo.rotation.z = thinking ? t * 0.3 : 0;
        glow.emissiveIntensity = current === "error" ? 0.15 : thinking ? 0.5 + Math.sin(t * 2) * 0.2 : 0.7;
        if (!lost) renderer.render(scene, camera);
      };
      const loop = (time: number) => {
        if (cancelled || lost || document.hidden || !visible || reducedMotion.matches) { frame = 0; return; }
        if (time - lastFrame > 1000 / 30) { render(time); lastFrame = time; }
        frame = requestAnimationFrame(loop);
      };
      const resume = () => {
        if (cancelled || lost) return;
        render(performance.now());
        if (!frame && !document.hidden && visible && !reducedMotion.matches) frame = requestAnimationFrame(loop);
      };
      redrawRef.current = resume;
      const resize = new ResizeObserver(() => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        resume();
      });
      resize.observe(host);
      const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); });
      intersection.observe(host);
      const contextLost = (event: Event) => {
        event.preventDefault();
        lost = true;
        cancelAnimationFrame(frame);
        frame = 0;
        setReady(false);
      };
      const contextRestored = () => { lost = false; setReady(true); resume(); };
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
      document.addEventListener("visibilitychange", resume);
      reducedMotion.addEventListener("change", resume);
      setReady(true);
      resume();
      release = () => {
        cancelAnimationFrame(frame);
        redrawRef.current = null;
        resize.disconnect();
        intersection.disconnect();
        document.removeEventListener("visibilitychange", resume);
        reducedMotion.removeEventListener("change", resume);
        renderer.domElement.removeEventListener("webglcontextlost", contextLost);
        renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    }).catch(() => { /* A blocked library download must not block the conversation. */ });

    return () => { cancelled = true; release?.(); };
  }, []);

  return (
    <div className={`${styles.avatar} ${className}`} data-status={status} data-renderer={ready ? "webgl" : "fallback"} role="img" aria-label={descriptions[status]}>
      <div className={styles.aura} aria-hidden="true" />
      <div className={`${styles.fallback} ${ready ? styles.hidden : ""}`} aria-hidden="true">
        <div className={styles.fallbackHead}><span /><span /><i /></div>
        <div className={styles.fallbackBody} />
      </div>
      <div ref={hostRef} className={`${styles.canvas} ${ready ? "" : styles.hidden}`} aria-hidden="true" />
      <div className={styles.shadow} aria-hidden="true" />
    </div>
  );
}
