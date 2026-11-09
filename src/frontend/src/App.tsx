import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Compass, Gamepad2, Info, Languages, Map, MapPin, Monitor, Moon, MousePointer2, Sparkles, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CityScene } from "@/features/city/CityScene";
import { cityBoard, slotById, slotsOnStreet, streetById } from "@/features/city/board";
import { useTheme, type Theme } from "@/features/settings/useTheme";
import { changeLanguage } from "@/i18n";

const themeOptions: { theme: Theme; Icon: typeof Monitor }[] = [
  { theme: "system", Icon: Monitor },
  { theme: "light", Icon: Sun },
  { theme: "dark", Icon: Moon },
];

export default function App() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [selectedStreetId, setSelectedStreetId] = useState("gauss");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>("N-01");
  const currentStreet = streetById(selectedStreetId) ?? cityBoard.streets[0];
  const currentSlot = selectedSlotId ? slotById(selectedSlotId) : undefined;
  const streetSlots = slotsOnStreet(selectedStreetId);

  const chooseStreet = (streetId: string) => {
    setSelectedStreetId(streetId);
    setSelectedSlotId(slotsOnStreet(streetId)[0]?.id ?? null);
  };

  const chooseSlot = (slotId: string) => {
    const slot = slotById(slotId);
    if (!slot) return;
    setSelectedSlotId(slotId);
    setSelectedStreetId(slot.streetId);
  };

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

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
          <Card className="min-w-0 overflow-hidden">
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
              data-board-version={cityBoard.version}
            >
              <CityScene
                selectedStreetId={selectedStreetId}
                selectedSlotId={selectedSlotId}
                onStreetSelect={chooseStreet}
                onSlotSelect={chooseSlot}
              />
              <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-[11px] font-semibold tracking-wide text-teal-100 backdrop-blur sm:left-5 sm:top-5">
                <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-emerald-300" />
                {t("city.previewTag")}
              </div>
              <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 text-[11px] font-medium text-slate-100/85 sm:bottom-5 sm:left-5 sm:right-5">
                <span className="rounded-lg bg-slate-950/60 px-3 py-2 backdrop-blur"><MousePointer2 aria-hidden="true" className="mr-1 inline size-3.5" />{t("city.controls")}</span>
                <span className="rounded-lg bg-slate-950/60 px-3 py-2 font-mono backdrop-blur">{cityBoard.slots.length} {t("city.slotsShort")}</span>
              </div>
            </div>
            <CardContent className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
              {t("city.notice")}
            </CardContent>
          </Card>

          <aside aria-label={t("city.inspect")} className="min-w-0 space-y-5">
            <Card>
              <CardHeader>
                <Badge className="w-fit border-primary/20 bg-primary/10 text-primary">{t("city.selectedStreet")}</Badge>
                <CardTitle className="mt-2 flex items-center gap-2"><MapPin aria-hidden="true" className="size-5 text-primary" /><span data-testid="selected-street">{currentStreet.name}</span></CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-muted p-3">
                    <p className="text-xs text-muted-foreground">{t("city.activitySpaces")}</p>
                    <output data-testid="street-slot-count" className="mt-1 block font-mono text-lg font-bold">{streetSlots.length}</output>
                  </div>
                  <div className="rounded-xl bg-muted p-3">
                    <p className="text-xs text-muted-foreground">{t("city.selectedSlot")}</p>
                    <output data-testid="selected-slot" className="mt-1 block font-mono text-lg font-bold">{currentSlot?.id ?? t("city.cityHall")}</output>
                  </div>
                </div>
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("city.adjacentStreets")}</p>
                  <div className="flex flex-wrap gap-2" data-testid="adjacency-list">
                    {currentStreet.neighbors.map((id) => (
                      <Button key={id} size="sm" variant="outline" data-testid={`adjacent-${id}`} onClick={() => chooseStreet(id)} className="h-8 text-xs">
                        {streetById(id)?.name ?? id}
                      </Button>
                    ))}
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
                <CardTitle className="flex items-center gap-2 text-base"><Map aria-hidden="true" className="size-4 text-primary" />{t("city.streets")}</CardTitle>
                <p className="text-xs leading-5 text-muted-foreground">{t("city.streetHelp")}</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {cityBoard.streets.map((street) => (
                    <Button
                      key={street.id}
                      type="button"
                      size="sm"
                      variant={selectedStreetId === street.id ? "default" : "outline"}
                      aria-pressed={selectedStreetId === street.id}
                      data-testid={`street-picker-${street.id}`}
                      onClick={() => chooseStreet(street.id)}
                      className="h-auto min-h-10 justify-start whitespace-normal px-2 py-2 text-left text-xs"
                    >
                      {street.name}
                    </Button>
                  ))}
                </div>
                <p className="mt-4 mb-2 text-xs font-semibold text-muted-foreground">{t("city.activitySpaces")}</p>
                <div className="grid max-h-32 grid-cols-4 gap-2 overflow-y-auto" role="group" aria-label={t("city.selectSlot")}>
                  {streetSlots.length > 0
                    ? streetSlots.map((slot) => (
                      <Button
                        key={slot.id}
                        type="button"
                        size="sm"
                        variant={slot.id === selectedSlotId ? "default" : "outline"}
                        aria-label={t("city.inspectSlot", { id: slot.id })}
                        aria-pressed={slot.id === selectedSlotId}
                        data-testid={`slot-picker-${slot.id}`}
                        onClick={() => chooseSlot(slot.id)}
                        className="text-xs"
                      >{slot.id}</Button>
                    ))
                    : <p className="col-span-4 text-xs text-muted-foreground">{t("city.mainSquareOnly")}</p>
                  }
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
