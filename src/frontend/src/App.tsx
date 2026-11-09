import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Compass, Gamepad2, Hexagon, Info, Languages, Monitor, Moon, MousePointer2, Sparkles, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CityScene } from "@/features/city/CityScene";
import { previewTiles } from "@/features/city/map";
import { useTheme, type Theme } from "@/features/settings/useTheme";
import { changeLanguage } from "@/i18n";

const visibleTileIds = ["0:0", "1:0", "0:1", "-1:0", "0:-1", "-1:1", "1:-1"];

export default function App() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [selectedId, setSelectedId] = useState("0:0");
  const selectedTile = previewTiles.find((tile) => tile.id === selectedId) ?? previewTiles[0];
  const visibleTiles = useMemo(() => visibleTileIds.map((id) => previewTiles.find((tile) => tile.id === id)).filter((tile) => tile !== undefined), []);
  const themeOptions: { theme: Theme; Icon: typeof Monitor }[] = [
    { theme: "system", Icon: Monitor },
    { theme: "light", Icon: Sun },
    { theme: "dark", Icon: Moon },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-card/75">
        <div className="mx-auto flex min-h-20 max-w-[1500px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-7 lg:px-10">
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl bg-primary text-xl font-black text-primary-foreground shadow-sm">E</div>
            <div>
              <div className="text-xl font-black leading-6 tracking-[-0.06em]">EDONISM<span className="text-primary">.</span></div>
              <div className="text-[11px] font-medium tracking-wide text-muted-foreground">{t("brand.tagline")}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div role="group" aria-label={t("theme.label")} className="flex items-center gap-0.5 rounded-xl border border-border bg-muted/50 p-1">
              {themeOptions.map(({ theme: option, Icon }) => (
                <Button
                  key={option}
                  aria-label={t(`theme.${option}`)}
                  aria-pressed={theme === option}
                  title={t(`theme.${option}`)}
                  size="icon"
                  variant={theme === option ? "secondary" : "ghost"}
                  onClick={() => setTheme(option)}
                  className="size-8 rounded-lg"
                >
                  <Icon aria-hidden="true" />
                </Button>
              ))}
            </div>
            <label className="flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm">
              <Languages aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="sr-only">{t("settings.language")}</span>
              <select
                aria-label={t("settings.language")}
                className="cursor-pointer bg-transparent font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={i18n.language === "en" ? "en" : "it"}
                onChange={(event) => changeLanguage(event.target.value as "it" | "en")}
              >
                <option value="it">IT</option>
                <option value="en">EN</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 pb-10 pt-8 sm:px-7 lg:px-10 lg:pt-12">
        <section aria-labelledby="welcome-heading" className="mb-8 flex flex-col justify-between gap-5 lg:mb-10 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary"><Sparkles aria-hidden="true" className="size-3.5" />{t("app.foundation")}</Badge>
              <span className="text-xs font-bold uppercase tracking-[0.19em] text-muted-foreground">{t("app.eyebrow")}</span>
            </div>
            <h1 id="welcome-heading" className="whitespace-pre-line text-3xl font-black leading-[1.13] tracking-[-0.045em] sm:text-4xl lg:text-5xl">{t("app.title")}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">{t("app.description")}</p>
          </div>
          <div className="hidden shrink-0 rounded-2xl border border-primary/20 bg-primary/10 px-5 py-4 text-primary lg:flex lg:items-center lg:gap-3">
            <Gamepad2 aria-hidden="true" className="size-7" />
            <div className="text-sm font-bold">{t("app.coming")}</div>
          </div>
        </section>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-start justify-between gap-3 pb-5">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl"><Compass aria-hidden="true" className="size-5 text-primary" />{t("city.title")}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t("city.subtitle")}</p>
              </div>
              <Badge className="hidden sm:inline-flex">{t("app.preview")}</Badge>
            </CardHeader>
            <div
              className="city-canvas relative mx-3 h-[340px] overflow-hidden rounded-xl border border-border/20 sm:mx-5 sm:h-[520px] lg:h-[570px]"
              role="region"
              aria-label={t("city.canvasLabel")}
              data-testid="city-renderer"
            >
              <CityScene selectedId={selectedId} onSelect={setSelectedId} />
              <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-[11px] font-semibold tracking-wide text-teal-100 backdrop-blur sm:left-5 sm:top-5">
                <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-emerald-300" />
                {t("city.previewTag")}
              </div>
              <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 text-[11px] font-medium text-slate-100/85 sm:bottom-5 sm:left-5 sm:right-5">
                <span className="rounded-lg bg-slate-950/60 px-3 py-2 backdrop-blur"><MousePointer2 aria-hidden="true" className="mr-1 inline size-3.5" />{t("city.controls")}</span>
                <span className="rounded-lg bg-slate-950/60 px-3 py-2 font-mono backdrop-blur">HEX / {previewTiles.length}</span>
              </div>
            </div>
            <CardContent className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
              {t("city.notice")}
            </CardContent>
          </Card>

          <aside aria-label={t("city.inspect")} className="space-y-5">
            <Card>
              <CardHeader>
                <Badge className="w-fit border-primary/20 bg-primary/10 text-primary">{t("city.active")}</Badge>
                <CardTitle className="mt-2 flex items-center gap-2"><Hexagon aria-hidden="true" className="size-5 text-primary" />{t(`tiles.${selectedTile.kind}`)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-muted p-3">
                    <p className="text-xs text-muted-foreground">{t("city.coordinate")}</p>
                    <output data-testid="selected-coordinate" className="mt-1 block font-mono text-lg font-bold">{selectedTile.q}, {selectedTile.r}</output>
                  </div>
                  <div className="rounded-xl bg-muted p-3">
                    <p className="text-xs text-muted-foreground">{t("city.district")}</p>
                    <p className="mt-1 text-sm font-semibold">{t(`tiles.${selectedTile.kind}`)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
                  <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{t("city.noRules")}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("city.inspect")}</CardTitle>
                <p className="text-xs leading-5 text-muted-foreground">{t("city.inspectHelp")}</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {visibleTiles.map((tile) => (
                    <Button
                      key={tile.id}
                      type="button"
                      size="sm"
                      variant={selectedId === tile.id ? "default" : "outline"}
                      aria-label={t("city.inspectHex", { q: tile.q, r: tile.r })}
                      aria-pressed={selectedId === tile.id}
                      data-testid={`tile-picker-${tile.id}`}
                      onClick={() => setSelectedId(tile.id)}
                      className="justify-start font-mono text-xs"
                    >
                      <Hexagon aria-hidden="true" className="size-3" />{tile.q}, {tile.r}
                    </Button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{t("city.accessibility")}</p>
              </CardContent>
            </Card>

            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="flex items-start gap-4 pt-5">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><Building2 aria-hidden="true" className="size-6" /></div>
                <div>
                  <p className="font-bold">{t("city.figurinestitle")}</p>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">{t("city.figurinesdescription")}</p>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-primary">{t("city.worldStatus")} · {t("city.worldValue")}</p>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>

      <footer className="border-t border-border/70 px-5 py-6 text-center text-xs text-muted-foreground">
        {t("footer.message")}
      </footer>
    </div>
  );
}
