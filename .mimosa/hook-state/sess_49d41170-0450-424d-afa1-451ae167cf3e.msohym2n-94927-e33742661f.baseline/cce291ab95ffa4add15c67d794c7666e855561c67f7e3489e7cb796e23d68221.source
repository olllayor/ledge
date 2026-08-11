import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';

type ShelfMode = 'empty' | 'single' | 'collage' | 'stack' | 'exporting';

const scenes = [
  { start: 0, duration: 6, node: <IntroScene /> },
  { start: 6, duration: 8, node: <CaptureScene /> },
  { start: 14, duration: 8, node: <ActionsScene /> },
  { start: 22, duration: 7, node: <PreferencesScene /> },
  { start: 29, duration: 7, node: <ReleaseScene /> },
] as const;

const palette = {
  ink: '#241b14',
  inkMuted: 'rgba(36, 27, 20, 0.62)',
  cream: '#f8efe5',
  creamDeep: '#ead9c5',
  coffee: '#2b211a',
  coffeeSoft: '#45352a',
  caramel: '#c98757',
  blue: '#4f8cff',
  green: '#56b886',
  line: 'rgba(58, 43, 31, 0.13)',
  white: 'rgba(255, 255, 255, 0.82)',
};

export const LedgeReleaseDemo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: palette.cream, fontFamily: 'Avenir Next, Helvetica Neue, sans-serif' }}>
      <Atmosphere />
      <DesktopStage />
      {scenes.map((scene) => (
        <Sequence
          key={scene.start}
          from={Math.round(scene.start * fps)}
          durationInFrames={Math.round(scene.duration * fps)}
          premountFor={Math.round(1 * fps)}
        >
          <SceneShell duration={scene.duration}>{scene.node}</SceneShell>
        </Sequence>
      ))}
      <TimelineDots frame={frame} />
    </AbsoluteFill>
  );
};

function SceneShell({ children, duration }: { children: ReactNode; duration: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacityIn = interpolate(frame, [0, 0.55 * fps], [0, 1], clamp());
  const opacityOut = interpolate(frame, [(duration - 0.55) * fps, duration * fps], [1, 0], clamp());
  const lift = interpolate(frame, [0, 0.7 * fps], [24, 0], { ...clamp(), easing: Easing.out(Easing.cubic) });

  return (
    <AbsoluteFill style={{ opacity: Math.min(opacityIn, opacityOut), transform: `translateY(${lift}px)` }}>
      {children}
    </AbsoluteFill>
  );
}

function IntroScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame, fps, durationInFrames: Math.round(0.9 * fps), config: { damping: 180 } });
  const shelfIn = spring({ frame: frame - 1.2 * fps, fps, durationInFrames: Math.round(0.8 * fps), config: { damping: 160 } });
  const title = interpolate(frame, [0.65 * fps, 1.25 * fps], [0, 1], clamp());

  return (
    <>
      <div style={headlineBlock}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, opacity: title }}>
          <LogoMark scale={logo} />
          <div>
            <p style={eyebrow}>Ledge 0.1.5</p>
            <h1 style={headline}>A shelf for everything in motion.</h1>
          </div>
        </div>
        <p style={{ ...subhead, opacity: title }}>
          Drop files, text, URLs, and pasted images into a floating macOS shelf. Pull them back out when you are ready.
        </p>
      </div>
      <div style={{ ...stageRight, transform: `translateY(${interpolate(shelfIn, [0, 1], [90, 0])}px) scale(${interpolate(shelfIn, [0, 1], [0.86, 1])})`, opacity: shelfIn }}>
        <ShelfMock mode="empty" />
      </div>
      <FloatingTag text="Menu-bar first" x={1250} y={248} delay={2.15} />
      <FloatingTag text="macOS 12+" x={1390} y={732} delay={2.45} />
    </>
  );
}

function CaptureScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = interpolate(frame, [0, 7 * fps], [0, 1], clamp());
  const cursorX = interpolate(progress, [0, 0.32, 0.52, 0.74, 1], [330, 1130, 1125, 1360, 1390]);
  const cursorY = interpolate(progress, [0, 0.32, 0.52, 0.74, 1], [760, 455, 455, 610, 610]);
  const shake = Math.sin(frame / 2) * interpolate(frame, [1.7 * fps, 2.35 * fps], [0, 18], clamp());
  const shelfMode: ShelfMode = frame < 2.4 * fps ? 'empty' : frame < 4.4 * fps ? 'collage' : 'stack';

  return (
    <>
      <Narrative
        kicker="Capture"
        title="Shake, shortcut, or use the tray."
        copy="Ledge appears where the cursor already is. Drop a mixed batch and it becomes a compact temporary shelf."
      />
      <div style={{ ...stageRight, transform: `translateX(${shake}px)` }}>
        <ShelfMock mode={shelfMode} />
      </div>
      <TransferCard title="Brand shots" kind="3 PNGs" x={cursorX - 190} y={cursorY - 110} opacity={frame < 4.2 * fps ? 1 : 0.2} />
      <TransferCard title="Release notes" kind="Text" x={520} y={330} opacity={interpolate(frame, [4.1 * fps, 4.8 * fps], [0, 1], clamp())} />
      <TransferCard title="github.com/olllayor/ledge" kind="URL" x={500} y={492} opacity={interpolate(frame, [4.7 * fps, 5.4 * fps], [0, 1], clamp())} />
      <Cursor x={cursorX} y={cursorY} />
    </>
  );
}

function ActionsScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const exportProgress = interpolate(frame, [5.1 * fps, 6.5 * fps], [0, 1], clamp());
  const menuProgress = spring({ frame: frame - 1.1 * fps, fps, durationInFrames: Math.round(0.55 * fps), config: { damping: 180 } });

  return (
    <>
      <Narrative
        kicker="Act"
        title="Preview, reveal, share, save, or drag out."
        copy="The shelf is temporary by design. It holds context just long enough to move work between apps cleanly."
      />
      <div style={stageRight}>
        <ShelfMock mode={exportProgress > 0.2 ? 'exporting' : 'stack'} />
        <ActionMenu progress={menuProgress} />
      </div>
      <ActionRail />
      <TransferCard
        title="Launch kit"
        kind="4 items"
        x={interpolate(exportProgress, [0, 1], [1180, 1585], clamp())}
        y={interpolate(exportProgress, [0, 1], [568, 510], clamp())}
        opacity={exportProgress}
      />
      <Cursor x={interpolate(frame, [4.6 * fps, 6.5 * fps], [1185, 1585], clamp())} y={interpolate(frame, [4.6 * fps, 6.5 * fps], [620, 550], clamp())} />
    </>
  );
}

function PreferencesScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const panel = spring({ frame, fps, durationInFrames: Math.round(0.8 * fps), config: { damping: 180 } });

  return (
    <>
      <Narrative
        kicker="Configure"
        title="Native feel where it matters."
        copy="A Swift helper handles shake detection and secure file references, while Electron keeps the shelf and preferences lightweight."
      />
      <div style={{ ...stageRight, width: 720, transform: `translateX(${interpolate(panel, [0, 1], [80, 0])}px)`, opacity: panel }}>
        <PreferencesMock />
      </div>
      <NativeStack frame={frame} fps={fps} />
    </>
  );
}

function ReleaseScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame, fps, durationInFrames: Math.round(0.9 * fps), config: { damping: 180 } });

  return (
    <>
      <div style={{ position: 'absolute', left: 190, top: 214, width: 950 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, transform: `scale(${interpolate(reveal, [0, 1], [0.9, 1])})`, transformOrigin: 'left center' }}>
          <LogoMark scale={1} />
          <div>
            <p style={eyebrow}>Release demo</p>
            <h2 style={{ ...headline, fontSize: 96, lineHeight: 0.94 }}>Ledge for macOS</h2>
          </div>
        </div>
        <p style={{ ...subhead, maxWidth: 760, marginTop: 34 }}>
          A fast temporary shelf for files, folders, snippets, links, and screenshots.
        </p>
        <div style={{ display: 'flex', gap: 18, marginTop: 44 }}>
          <Pill>DMG or ZIP</Pill>
          <Pill>Apple Silicon</Pill>
          <Pill>MIT licensed</Pill>
        </div>
      </div>
      <div style={{ ...stageRight, top: 248 }}>
        <ShelfMock mode={frame > 3.2 * fps ? 'single' : 'collage'} />
      </div>
      <DownloadCard />
    </>
  );
}

function Atmosphere() {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 18;

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 18% 20%, rgba(244,200,182,0.52), transparent 30%), radial-gradient(circle at 82% 76%, rgba(216,191,164,0.48), transparent 34%), linear-gradient(135deg, #fbf4eb 0%, #ead8c3 100%)' }} />
      <div style={{ position: 'absolute', left: 1060 + drift, top: 105, width: 580, height: 580, borderRadius: 999, background: 'rgba(255,255,255,0.24)', filter: 'blur(4px)' }} />
      <div style={{ position: 'absolute', left: 115, top: 755 - drift, width: 420, height: 420, borderRadius: 999, background: 'rgba(198,137,91,0.16)', filter: 'blur(3px)' }} />
    </AbsoluteFill>
  );
}

function DesktopStage() {
  return (
    <div style={{ position: 'absolute', right: 96, top: 118, width: 1040, height: 820, borderRadius: 52, background: 'rgba(255,255,255,0.33)', border: `1px solid ${palette.line}`, boxShadow: '0 42px 110px rgba(83,58,37,0.18)', overflow: 'hidden' }}>
      <div style={{ height: 46, display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 22, background: 'rgba(255,255,255,0.32)', borderBottom: `1px solid ${palette.line}` }}>
        <Dot color="#ff605c" />
        <Dot color="#ffbd44" />
        <Dot color="#00ca4e" />
        <span style={{ marginLeft: 20, color: palette.inkMuted, fontSize: 18 }}>Desktop</span>
      </div>
      <div style={{ position: 'absolute', inset: '46px 0 0', background: 'linear-gradient(135deg, rgba(77,118,168,0.11), rgba(255,255,255,0.1))' }} />
    </div>
  );
}

function ShelfMock({ mode }: { mode: ShelfMode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = interpolate(Math.sin(frame / 12), [-1, 1], [0, 1]);
  const count = mode === 'collage' ? '3 Images' : mode === 'stack' || mode === 'exporting' ? '4 Items' : mode === 'single' ? '1 Image' : 'Drop files here';

  return (
    <div style={{ width: 318, minHeight: 292, borderRadius: 34, padding: '18px 16px 16px', background: 'linear-gradient(180deg, rgba(39,34,31,0.92), rgba(21,18,17,0.92))', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 42px 72px rgba(36,27,20,0.34), inset 0 1px 0 rgba(255,255,255,0.16)', color: 'white', backdropFilter: 'blur(20px)' }}>
      <div style={{ width: 48, height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.18)', margin: '0 auto 12px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
        <ChromeButton tone="close" />
        <ChromeButton />
      </div>
      <div style={{ height: 170, display: 'grid', placeItems: 'center', borderRadius: 24, background: mode === 'empty' ? `rgba(79,140,255,${0.08 + pulse * 0.08})` : 'transparent', border: mode === 'empty' ? '1px dashed rgba(255,255,255,0.22)' : '1px solid transparent' }}>
        {mode === 'empty' ? <span style={{ fontSize: 21, fontWeight: 700, color: 'rgba(255,255,255,0.72)' }}>{count}</span> : <ShelfContent mode={mode} fps={fps} />}
      </div>
      {mode !== 'empty' ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 11 }}>
          <div style={{ padding: '8px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.13)', color: mode === 'exporting' ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: 700 }}>
            {count}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShelfContent({ mode, fps }: { mode: ShelfMode; fps: number }) {
  const frame = useCurrentFrame();
  const entrance = spring({ frame: frame - 0.2 * fps, fps, durationInFrames: Math.round(0.55 * fps), config: { damping: 170 } });
  const opacity = mode === 'exporting' ? 0.18 : 1;
  const scale = mode === 'exporting' ? 0.94 : interpolate(entrance, [0, 1], [0.82, 1]);

  if (mode === 'single') {
    return <PhotoCard style={{ opacity, transform: `scale(${scale})` }} rotate={0} color="#e8ba8e" />;
  }

  if (mode === 'collage') {
    return (
      <div style={{ position: 'relative', width: 210, height: 154, opacity, transform: `scale(${scale})` }}>
        <PhotoCard rotate={-8} color="#d98d68" style={{ left: 24, top: 18, zIndex: 1 }} />
        <PhotoCard rotate={7} color="#7fafc8" style={{ left: 82, top: 12, zIndex: 2 }} />
        <PhotoCard rotate={0} color="#e0c17e" style={{ left: 58, top: 30, zIndex: 3 }} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: 190, height: 128, opacity, transform: `scale(${scale})` }}>
      <FileGlyph label="PDF" x={22} y={20} rotate={-8} />
      <FileGlyph label="TXT" x={66} y={12} rotate={4} />
      <FileGlyph label="URL" x={112} y={24} rotate={9} />
      <PhotoCard rotate={0} color="#d98d68" style={{ left: 62, top: 34, zIndex: 5, width: 76, height: 90 }} />
    </div>
  );
}

function PhotoCard({ rotate, color, style }: { rotate: number; color: string; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', width: 96, height: 120, borderRadius: 8, background: '#f8f1e8', border: '1px solid rgba(255,255,255,0.55)', boxShadow: '0 16px 22px rgba(0,0,0,0.22)', transform: `rotate(${rotate}deg)`, overflow: 'hidden', ...style }}>
      <div style={{ height: '62%', background: `linear-gradient(135deg, ${color}, #fff2d8)` }} />
      <div style={{ height: 9, width: 54, margin: '12px 0 0 12px', borderRadius: 9, background: 'rgba(48,38,31,0.22)' }} />
      <div style={{ height: 7, width: 34, margin: '7px 0 0 12px', borderRadius: 9, background: 'rgba(48,38,31,0.14)' }} />
    </div>
  );
}

function FileGlyph({ label, x, y, rotate }: { label: string; x: number; y: number; rotate: number }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 76, height: 90, borderRadius: 12, background: '#fffaf3', color: palette.coffee, transform: `rotate(${rotate}deg)`, boxShadow: '0 14px 22px rgba(0,0,0,0.2)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18 }}>
      {label}
    </div>
  );
}

function ActionMenu({ progress }: { progress: number }) {
  const items = ['Quick Look', 'Reveal in Finder', 'Open', 'Share All', 'Clear Shelf'];

  return (
    <div style={{ position: 'absolute', left: 196, top: 44, width: 220, padding: 10, borderRadius: 22, background: 'rgba(30,27,25,0.92)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 24px 44px rgba(0,0,0,0.28)', opacity: progress, transform: `translateY(${interpolate(progress, [0, 1], [-18, 0])}px) scale(${interpolate(progress, [0, 1], [0.94, 1])})` }}>
      {items.map((item, index) => (
        <div key={item} style={{ height: 39, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderRadius: 14, color: index === 4 ? '#ffc5b8' : 'rgba(255,255,255,0.86)', background: index === 0 ? 'rgba(255,255,255,0.09)' : 'transparent', fontSize: 15 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: index === 4 ? '#ff8f78' : palette.blue }} />
          {item}
        </div>
      ))}
    </div>
  );
}

function PreferencesMock() {
  const rows = [
    ['Launch at login', true],
    ['Global shortcut', '⌘ ⇧ Space'],
    ['Shake gesture', true],
    ['Shake sensitivity', 'Balanced'],
    ['Native helper', 'Online'],
    ['Accessibility', 'Trusted'],
  ] as const;

  return (
    <div style={{ width: 720, height: 520, borderRadius: 34, background: 'rgba(255,255,255,0.72)', border: `1px solid ${palette.line}`, boxShadow: '0 42px 90px rgba(83,58,37,0.22)', overflow: 'hidden' }}>
      <div style={{ height: 58, display: 'flex', alignItems: 'center', gap: 10, padding: '0 22px', borderBottom: `1px solid ${palette.line}` }}>
        <Dot color="#ff605c" />
        <Dot color="#ffbd44" />
        <Dot color="#00ca4e" />
        <strong style={{ marginLeft: 20, color: palette.ink, fontSize: 19 }}>General</strong>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', height: 'calc(100% - 58px)' }}>
        <div style={{ padding: 24, borderRight: `1px solid ${palette.line}`, color: palette.inkMuted, display: 'grid', alignContent: 'start', gap: 16, fontWeight: 700 }}>
          {['Shelf Activation', 'Shelf Interaction', 'General', 'Cloud Sharing'].map((item) => (
            <div key={item} style={{ padding: '12px 14px', borderRadius: 16, background: item === 'General' ? 'rgba(43,33,26,0.1)' : 'transparent', color: item === 'General' ? palette.ink : palette.inkMuted }}>
              {item}
            </div>
          ))}
        </div>
        <div style={{ padding: 26, display: 'grid', gap: 13 }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', borderRadius: 18, background: 'rgba(255,255,255,0.58)', border: `1px solid ${palette.line}`, color: palette.ink, fontSize: 18, fontWeight: 700 }}>
              <span>{label}</span>
              {typeof value === 'boolean' ? <Toggle checked={value} /> : <span style={{ color: value === 'Online' || value === 'Trusted' ? palette.green : palette.inkMuted }}>{value}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NativeStack({ frame, fps }: { frame: number; fps: number }) {
  const items = ['Swift helper', 'Bookmark refs', 'Shake detector'];

  return (
    <div style={{ position: 'absolute', left: 198, top: 650, display: 'flex', gap: 16 }}>
      {items.map((item, index) => {
        const reveal = interpolate(frame, [(1.2 + index * 0.25) * fps, (1.65 + index * 0.25) * fps], [0, 1], clamp());
        return (
          <div key={item} style={{ opacity: reveal, transform: `translateY(${interpolate(reveal, [0, 1], [24, 0])}px)`, padding: '16px 18px', borderRadius: 20, background: palette.white, border: `1px solid ${palette.line}`, color: palette.ink, fontWeight: 800, fontSize: 18 }}>
            {item}
          </div>
        );
      })}
    </div>
  );
}

function ActionRail() {
  const actions = ['Quick Look', 'Reveal', 'Copy', 'Save', 'Share', 'Drag out'];

  return (
    <div style={{ position: 'absolute', left: 194, top: 662, display: 'flex', gap: 13 }}>
      {actions.map((action) => (
        <Pill key={action}>{action}</Pill>
      ))}
    </div>
  );
}

function DownloadCard() {
  return (
    <div style={{ position: 'absolute', right: 170, bottom: 150, width: 438, padding: 28, borderRadius: 30, background: 'rgba(255,255,255,0.74)', border: `1px solid ${palette.line}`, boxShadow: '0 28px 70px rgba(83,58,37,0.2)' }}>
      <p style={{ ...eyebrow, color: palette.caramel }}>Release package</p>
      <h3 style={{ margin: '8px 0 12px', color: palette.ink, fontSize: 36, lineHeight: 1 }}>Download the latest build</h3>
      <p style={{ margin: 0, color: palette.inkMuted, fontSize: 20, lineHeight: 1.35 }}>Open the DMG, drag Ledge to Applications, and grant Accessibility only if you want shake-to-open.</p>
    </div>
  );
}

function TransferCard({ title, kind, x, y, opacity }: { title: string; kind: string; x: number; y: number; opacity: number }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 270, padding: 18, borderRadius: 24, background: 'rgba(255,255,255,0.78)', border: `1px solid ${palette.line}`, boxShadow: '0 22px 50px rgba(83,58,37,0.18)', opacity }}>
      <p style={{ margin: 0, color: palette.ink, fontWeight: 850, fontSize: 21, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</p>
      <p style={{ margin: '5px 0 0', color: palette.inkMuted, fontWeight: 700, fontSize: 16 }}>{kind}</p>
    </div>
  );
}

function Cursor({ x, y }: { x: number; y: number }) {
  return (
    <svg style={{ position: 'absolute', left: x, top: y, width: 44, height: 54, filter: 'drop-shadow(0 10px 12px rgba(36,27,20,0.22))' }} viewBox="0 0 44 54">
      <path d="M4 4l30 28-16 2-7 15L4 4Z" fill="#fffaf4" stroke="#2b211a" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

function Narrative({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return (
    <div style={headlineBlock}>
      <p style={eyebrow}>{kicker}</p>
      <h2 style={{ ...headline, fontSize: 74 }}>{title}</h2>
      <p style={subhead}>{copy}</p>
    </div>
  );
}

function FloatingTag({ text, x, y, delay }: { text: string; x: number; y: number; delay: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame: frame - delay * fps, fps, durationInFrames: Math.round(0.55 * fps), config: { damping: 180 } });

  return (
    <div style={{ position: 'absolute', left: x, top: y, padding: '14px 18px', borderRadius: 999, background: palette.white, border: `1px solid ${palette.line}`, color: palette.ink, fontSize: 18, fontWeight: 800, opacity: reveal, transform: `translateY(${interpolate(reveal, [0, 1], [18, 0])}px)` }}>
      {text}
    </div>
  );
}

function TimelineDots({ frame }: { frame: number }) {
  const { fps } = useVideoConfig();

  return (
    <div style={{ position: 'absolute', left: 190, bottom: 78, display: 'flex', gap: 10 }}>
      {scenes.map((scene) => {
        const active = frame >= scene.start * fps && frame < (scene.start + scene.duration) * fps;
        return <div key={scene.start} style={{ width: active ? 42 : 12, height: 12, borderRadius: 99, background: active ? palette.coffee : 'rgba(43,33,26,0.22)' }} />;
      })}
    </div>
  );
}

function LogoMark({ scale }: { scale: number }) {
  return (
    <div style={{ width: 114, height: 114, borderRadius: 30, background: 'linear-gradient(135deg, #f7eee3, #e8d9c5)', boxShadow: '0 24px 42px rgba(83,58,37,0.22)', display: 'grid', placeItems: 'center', transform: `scale(${scale})` }}>
      <div style={{ width: 72, height: 16, borderRadius: 20, background: palette.coffee, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 16, bottom: 18, width: 38, height: 48, borderRadius: 12, background: '#fff8f0', boxShadow: '20px 7px 0 #2b211a' }} />
      </div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '13px 18px', borderRadius: 999, background: palette.white, border: `1px solid ${palette.line}`, color: palette.ink, fontWeight: 800, fontSize: 18 }}>
      {children}
    </div>
  );
}

function ChromeButton({ tone }: { tone?: 'close' }) {
  return (
    <div style={{ width: 32, height: 32, borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)', background: tone === 'close' ? 'rgba(255,96,92,0.78)' : 'rgba(255,255,255,0.1)', display: 'grid', placeItems: 'center' }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.72)' }} />
    </div>
  );
}

function Toggle({ checked }: { checked: boolean }) {
  return (
    <div style={{ width: 50, height: 28, borderRadius: 99, background: checked ? palette.green : 'rgba(43,33,26,0.18)', padding: 4 }}>
      <div style={{ width: 20, height: 20, borderRadius: 99, background: 'white', marginLeft: checked ? 22 : 0 }} />
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 13, height: 13, borderRadius: 99, background: color }} />;
}

function clamp() {
  return { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
}

const headlineBlock: CSSProperties = {
  position: 'absolute',
  left: 190,
  top: 230,
  width: 760,
};

const stageRight: CSSProperties = {
  position: 'absolute',
  right: 430,
  top: 342,
};

const eyebrow: CSSProperties = {
  margin: 0,
  color: palette.caramel,
  fontSize: 20,
  fontWeight: 900,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

const headline: CSSProperties = {
  margin: '10px 0 0',
  color: palette.ink,
  fontSize: 82,
  lineHeight: 0.98,
  letterSpacing: '-0.06em',
  fontWeight: 900,
};

const subhead: CSSProperties = {
  margin: '28px 0 0',
  color: palette.inkMuted,
  fontSize: 27,
  lineHeight: 1.28,
  maxWidth: 690,
  fontWeight: 600,
};
