import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // FIX (remplacement de Groq) : le serveur IA est désormais un serveur LOCAL
  // compatible OpenAI. Le navigateur ne peut pas l'appeler directement (aucun
  // en-tête CORS, vérifié) → le proxy Vite relaie `/api/llm` vers le serveur,
  // clé comprise. La clé ne quitte jamais le processus Node.
  const env = loadEnv(mode, process.cwd(), "");
  // FIX (IA en ligne) : OpenRouter hébergé par défaut — marche aussi PC éteint.
  // LLM_BASE_URL peut toujours pointer vers le serveur local (127.0.0.1:31415).
  const LLM_BASE_URL = (env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const LLM_API_KEY = env.LLM_API_KEY || "";
  /** En-têtes du proxy : la clé est injectée ICI, côté processus Node. */
  const proxyHeaders: Record<string, string> = {};
  if (LLM_API_KEY) proxyHeaders.Authorization = `Bearer ${LLM_API_KEY}`;

  return {
    plugins: [react()],
    server: {
      port: 5199,
      strictPort: true,
      proxy: {
        "/api/llm": {
          target: LLM_BASE_URL,
          changeOrigin: true,
          // /api/llm  →  {LLM_BASE_URL}/chat/completions
          rewrite: (p) => p.replace(/^\/api\/llm$/, "/chat/completions"),
          // Le serveur attend la clé dans l'en-tête Authorization.
          headers: proxyHeaders,
        },
      },
    },
    test: {
      environment: "node",
      include: ["*.test.ts"],
    },
  };
});
