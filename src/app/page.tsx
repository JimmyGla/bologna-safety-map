import { Footer } from "@/components/Footer";
import { LangProvider } from "@/components/i18n";
import { SafetyMap } from "@/components/map/SafetyMap";

export default function Home() {
  return (
    <LangProvider>
      <div className="flex h-dvh flex-col">
        <main className="relative min-h-0 flex-1">
          <SafetyMap />
        </main>
        <Footer />
      </div>
    </LangProvider>
  );
}
