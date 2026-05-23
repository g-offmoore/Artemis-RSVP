"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { EventSummary } from "../../src/lib/artemis-api";

type ViewMode = "month" | "week";

function isoDate(input: Date) { return input.toISOString().slice(0, 10); }
function dayKey(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); }
function pressure(participants: number, tables: number) { if (!tables) return participants > 0 ? "High" : "Low"; const ratio = participants / tables; if (ratio >= 5) return "High"; if (ratio >= 3) return "Medium"; return "Low"; }

export function CalendarView({ events }: { events: EventSummary[] }) {
  const [view, setView] = useState<ViewMode>("month");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [gameSystem, setGameSystem] = useState("all");
  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const systems = [...new Set(events.map((e) => e.gameSystem))].sort();
  const statuses = [...new Set(events.map((e) => e.status))].sort();
  const channels = [...new Set(events.map((e) => e.channelId))].sort();

  const filtered = useMemo(() => events.filter((event) => {
    const start = new Date(event.startAt);
    if (gameSystem !== "all" && event.gameSystem !== gameSystem) return false;
    if (status !== "all" && event.status !== status) return false;
    if (channel !== "all" && event.channelId !== channel) return false;
    if (fromDate && start < new Date(`${fromDate}T00:00:00`)) return false;
    if (toDate && start > new Date(`${toDate}T23:59:59`)) return false;
    return true;
  }), [channel, events, fromDate, gameSystem, status, toDate]);

  const byDay = useMemo(() => {
    const map = new Map<number, EventSummary[]>();
    for (const event of filtered) {
      const key = dayKey(new Date(event.startAt));
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [filtered]);

  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const monthGridStart = new Date(monthStart);
  monthGridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const monthDays = Array.from({ length: 42 }, (_, i) => { const d = new Date(monthGridStart); d.setDate(monthGridStart.getDate() + i); return d; });
  const weekStart = new Date(anchorDate); weekStart.setDate(anchorDate.getDate() - anchorDate.getDay());
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; });

  const move = (delta: number) => { const n = new Date(anchorDate); n.setDate(n.getDate() + (view === "week" ? delta * 7 : delta * 30)); setAnchorDate(n); };

  const renderCell = (date: Date) => {
    const entries = byDay.get(dayKey(date)) ?? [];
    const participantCount = entries.reduce((sum, e) => sum + (e._count?.participants ?? 0), 0);
    const tablesCount = entries.reduce((sum, e) => sum + (e._count?.tables ?? 0), 0);
    return <div className="calendar-cell" key={dayKey(date)}><div className="calendar-cell-head"><strong>{date.getDate()}</strong><Link className="muted" href={`/?createDate=${isoDate(date)}#create-event`}>Create</Link></div><div className="calendar-heat muted"><span>P: {participantCount}</span><span>T: {tablesCount}</span><span>Pressure: {pressure(participantCount, tablesCount)}</span></div><ul>{entries.map((event) => <li key={event.id}><Link href={`/events/${event.id}`}>{event.title}</Link></li>)}</ul></div>;
  };

  return <>
    <section className="section-panel"><div className="filters-row">
      <label>Game system<select value={gameSystem} onChange={(e) => setGameSystem(e.target.value)}><option value="all">All</option>{systems.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All</option>{statuses.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>Channel<select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="all">All</option>{channels.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>From<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
      <label>To<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
    </div></section>
    <section className="section-panel"><div className="section-heading"><div><h2>Calendar</h2></div><div className="calendar-controls"><button className="button secondary" type="button" onClick={() => move(-1)}>Previous</button><button className="button secondary" type="button" onClick={() => setView(view === "month" ? "week" : "month")}>{view === "month" ? "Switch to week" : "Switch to month"}</button><button className="button secondary" type="button" onClick={() => move(1)}>Next</button></div></div><div className="calendar-grid">{(view === "month" ? monthDays : weekDays).map(renderCell)}</div></section>
  </>;
}
