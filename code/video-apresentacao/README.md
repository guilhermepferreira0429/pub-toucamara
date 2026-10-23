# Vídeo de apresentação · Tou, Câmara?

Vídeo de 78 s em Remotion (1920×1080, 30 fps), sem som, com as mesmas cores, letra e números do pitch.

```bash
cd code/video-apresentacao
npm install
npm run estudio     # pré-visualizar e mexer
npm run render      # gera out/toucamara.mp4
```

| Cena | Ficheiro | O que mostra |
|---|---|---|
| Abertura | `src/cenas/Abertura.tsx` | 22:04, sem água em casa, a câmara fechada |
| Problema | `src/cenas/Problema.tsx` | Mais de 20 sites onde está a resposta |
| Junta | `src/cenas/Junta.tsx` | Os sites juntam-se na marca |
| Chamada | `src/cenas/Chamada.tsx` | Pergunta e resposta reais (avaliação, pergunta 69) e o SMS |
| Ação | `src/cenas/Acao.tsx` | Licença de esplanada tratada na conversa, com a taxa oficial |
| Prova | `src/cenas/Prova.tsx` | As 180 perguntas: 18 → 83 saíram a saber o que fazer |
| Painel | `src/cenas/Painel.tsx` | O lado da câmara (exemplo ilustrativo) |
| Fecho | `src/cenas/Fecho.tsx` | O Estado aprende a falar com as pessoas; o endereço |

Durações em `src/Apresentacao.tsx`. Os números da prova estão em `src/avaliacao.ts`, copiados de
`code/pitch/src/conteudo/avaliacao.ts`: ao correr uma ronda nova, atualizar os dois.
Para pôr voz ou música: `<Audio src={staticFile('voz.mp3')} />` em `Apresentacao.tsx`.
