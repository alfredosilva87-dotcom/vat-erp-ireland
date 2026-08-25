/**
 * A onda do pé da barra lateral.
 *
 * São faixas cheias com deriva diagonal MAIS fios de 1px traçando o topo de
 * cada uma. Os fios é que criam o entrelaçado: sem eles as faixas leem como
 * sedimento empilhado, que foi o defeito das primeiras tentativas.
 *
 * Cor por token (`--c-wave-*` em app/globals.css) para o tema escuro não
 * brilhar — lavanda clara sobre fundo escuro rouba atenção do menu.
 *
 * `aria-hidden` e `pointer-events:none`: é assinatura visual, não elemento de
 * interface, e não deve aparecer para leitor de tela nem receber clique.
 */
export default function RailWave() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[262px] overflow-hidden"
    >
      <div
        className="absolute -bottom-[150px] -left-[100px] h-[300px] w-[350px] rounded-full blur-[20px]"
        style={{
          background:
            "radial-gradient(circle, rgb(var(--c-wave-glow)), transparent 68%)",
        }}
      />
      <svg viewBox="0 0 274 330" preserveAspectRatio="none" className="block h-full w-full">
        <path
          d="M0 165 C42 170 70 185 101 198 C134 212 164 209 190 193 C221 174 247 145 274 130 L274 330 L0 330 Z"
          fill="rgb(var(--c-wave-bg))" opacity=".78"
        />
        <path
          d="M0 228 C39 245 70 246 103 231 C139 214 166 191 197 169 C225 149 251 134 274 128 L274 330 L0 330 Z"
          fill="rgb(var(--c-wave-light))" opacity=".82"
        />
        <path
          d="M0 226 C40 243 70 244 103 229 C139 212 166 189 197 167 C225 147 251 132 274 126"
          fill="none" stroke="rgb(var(--c-wave-l1))" strokeWidth="1.4"
        />
        <path
          d="M0 249 C38 265 68 266 103 250 C139 234 166 211 197 190 C226 170 251 155 274 150 L274 205 C250 211 225 226 197 247 C164 271 135 294 99 306 C66 317 34 309 0 294 Z"
          fill="rgb(var(--c-wave-purple))" opacity=".74"
        />
        <path
          d="M0 249 C38 265 68 266 103 250 C139 234 166 211 197 190 C226 170 251 155 274 150"
          fill="none" stroke="rgb(var(--c-wave-l2))" strokeWidth="1"
        />
        <path
          d="M0 294 C34 309 66 317 99 306 C135 294 164 271 197 247 C225 226 250 211 274 205 L274 330 L0 330 Z"
          fill="rgb(var(--c-wave-bottom))" opacity=".78"
        />
        <path
          d="M0 294 C34 309 66 317 99 306 C135 294 164 271 197 247 C225 226 250 211 274 205"
          fill="none" stroke="rgb(var(--c-wave-l3))" strokeWidth="1"
        />
      </svg>
    </div>
  );
}
