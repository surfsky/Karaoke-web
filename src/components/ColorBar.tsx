import { useEffect, useRef, type CSSProperties } from 'react';

interface Circle {
  x: number;
  y: number;
  r: number;
  alpha: number;
  vx: number;
  vy: number;
}

interface ColorBarProps {
  className?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
  circleCount?: number;
  /** 圆形运动速度，单位 px/s */
  speed?: number;
}

export function ColorBar({
  className = '',
  style,
  children,
  circleCount = 8,
  speed = 18,
}: ColorBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const circlesRef = useRef<Circle[]>([]);
  const activeRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const lastTimeRef = useRef<number | null>(null);

  const randomBetween = (min: number, max: number) =>
    Math.random() * (max - min) + min;

  const createCircles = (w: number, h: number) => {
    const circles: Circle[] = [];
    const minR = Math.min(6, w / 10, h / 10);
    const maxR = Math.min(Math.max(w, h) * 0.22, 70);
    for (let i = 0; i < circleCount; i++) {
      const r = randomBetween(minR, Math.max(minR, maxR));
      circles.push({
        x: randomBetween(-r, w + r),
        y: randomBetween(-r, h + r),
        r,
        alpha: randomBetween(0.08, 0.28),
        vx: 0,
        vy: 0,
      });
    }
    circlesRef.current = circles;
  };

  const resize = () => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeRef.current = { w: rect.width, h: rect.height, dpr };

    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    if (circlesRef.current.length === 0) {
      createCircles(rect.width, rect.height);
    } else {
      // 窗口变化时把圆形限制在可视区域内，避免全部漂到外面
      circlesRef.current.forEach(c => {
        c.x = Math.max(-c.r, Math.min(rect.width + c.r, c.x));
        c.y = Math.max(-c.r, Math.min(rect.height + c.r, c.y));
      });
    }
    draw();
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h, dpr } = sizeRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    circlesRef.current.forEach(c => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${c.alpha})`;
      ctx.fill();
    });

    ctx.restore();
  };

  const assignRandomVelocities = () => {
    circlesRef.current.forEach(c => {
      const angle = randomBetween(0, Math.PI * 2);
      const v = randomBetween(speed * 0.4, speed * 1.2);
      c.vx = Math.cos(angle) * v;
      c.vy = Math.sin(angle) * v;
    });
  };

  const update = (dt: number) => {
    const { w, h } = sizeRef.current;
    circlesRef.current.forEach(c => {
      c.x += c.vx * dt;
      c.y += c.vy * dt;

      // 超出边界后从反方向进入
      if (c.x - c.r > w) c.x = -c.r;
      else if (c.x + c.r < 0) c.x = w + c.r;

      if (c.y - c.r > h) c.y = -c.r;
      else if (c.y + c.r < 0) c.y = h + c.r;
    });
  };

  const loop = (time: number) => {
    if (!activeRef.current) {
      rafRef.current = null;
      lastTimeRef.current = null;
      return;
    }

    if (lastTimeRef.current == null) {
      lastTimeRef.current = time;
    }
    const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
    lastTimeRef.current = time;

    update(dt);
    draw();
    rafRef.current = requestAnimationFrame(loop);
  };

  const start = () => {
    if (activeRef.current) return;
    activeRef.current = true;
    assignRandomVelocities();
    lastTimeRef.current = null;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(loop);
    }
  };

  const stop = () => {
    activeRef.current = false;
    // loop 会在下一帧自行清理 rafRef
  };

  useEffect(() => {
    resize();
    const ro = new ResizeObserver(() => resize());
    if (containerRef.current) ro.observe(containerRef.current);

    const handleVisibility = () => {
      if (document.hidden) {
        activeRef.current = false;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      ro.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={style}
      className={`relative overflow-hidden ${className}`}
      onMouseEnter={start}
      onMouseLeave={stop}
      onTouchStart={start}
      onTouchEnd={stop}
      onPointerEnter={start}
      onPointerLeave={stop}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
