import { useEffect, useState } from "react";
import ShelfPage from "./pages/ShelfPage";
import ReaderPage from "./pages/ReaderPage";
import SettingsPage from "./pages/SettingsPage";
import { Book } from "./types";
import { applyReaderSettings, loadReaderSettings } from "./theme";

export type View =
  | { name: "shelf" }
  | { name: "reader"; book: Book }
  | { name: "settings" };

export default function App() {
  const [view, setView] = useState<View>({ name: "shelf" });
  const [shelfTick, setShelfTick] = useState(0);

  useEffect(() => {
    document.title = "SuccintReader";
  }, []);

  if (view.name === "reader") {
    return (
      <ReaderPage
        book={view.book}
        onExit={() => {
          setShelfTick((t) => t + 1);
          setView({ name: "shelf" });
        }}
        onOpenSettings={() => setView({ name: "settings" })}
      />
    );
  }
  if (view.name === "settings") {
    return <SettingsPage onBack={() => setView({ name: "shelf" })} />;
  }
  return (
    <ShelfPage
      tick={shelfTick}
      onOpenBook={async (book) => {
        // 先应用阅读主题再切换视图，避免进入阅读页时闪烁默认配色
        applyReaderSettings(await loadReaderSettings(book.id));
        setView({ name: "reader", book });
      }}
      onOpenSettings={() => setView({ name: "settings" })}
    />
  );
}
