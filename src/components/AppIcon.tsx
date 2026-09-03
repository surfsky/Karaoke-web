interface AppIconProps {
  className?: string;
  showWaveform?: boolean;
}

export function AppIcon({ className = '', showWaveform = true }: AppIconProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="app-icon-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="100" fill="url(#app-icon-bg)" />
      <g fill="white">
        <path d="M348 156c-3.2-1.6-116.8-57.6-124-61.2-4-2-8.8-2.8-14-1.2-5.2 1.6-9.2 5.6-10.8 10.8-1.6 5.2-0.8 14.4-0.8 20.4v178.4c-10-3.2-26.4-7.2-44 0.8-16.4 7.6-30.8 32-30.8 57.2 0 26.4 14.8 50.4 40 50.4 22.8 0 42.8-15.2 42.8-42.8V297.2c0-5.2 0-7.6 0.8-9.6 0.8-1.6 2.8-3.2 4.8-4 6.8-2.4 82.4-37.2 88.4-40 3.6-1.6 6.4-4 7.6-7.2 1.2-3.6 2-7.6 2-12.8V168c0-4.4-0.8-8.4-2.4-10.8-1.6-2.4-4-3.2-6.4-1.2z" />
      </g>
      {showWaveform && (
        <g fill="white">
          <rect x="96" y="404" width="16" height="40" rx="4" />
          <rect x="128" y="380" width="16" height="64" rx="4" />
          <rect x="160" y="356" width="16" height="88" rx="4" />
          <rect x="192" y="372" width="16" height="72" rx="4" />
          <rect x="224" y="340" width="16" height="104" rx="4" />
          <rect x="256" y="328" width="16" height="116" rx="4" />
          <rect x="288" y="348" width="16" height="96" rx="4" />
          <rect x="320" y="364" width="16" height="80" rx="4" />
          <rect x="352" y="388" width="16" height="56" rx="4" />
          <rect x="384" y="400" width="16" height="44" rx="4" />
          <rect x="416" y="412" width="16" height="32" rx="4" />
        </g>
      )}
    </svg>
  );
}
