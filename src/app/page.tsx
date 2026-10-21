import { SafetyMap } from "@/components/map/SafetyMap";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col">
      <main className="relative min-h-0 flex-1">
        <SafetyMap />
      </main>
      <footer className="shrink-0 border-t border-gray-200 bg-white px-4 py-2 text-center text-xs text-gray-700">
        <strong>Not an official source.</strong> In an emergency call{" "}
        <a href="tel:112" className="font-semibold text-red-700 underline">
          112
        </a>
        . Check Comune di Bologna and Questura channels.{" "}
        <a href="/privacy" className="ml-1 text-gray-500 underline">
          Privacy
        </a>
      </footer>
    </div>
  );
}
