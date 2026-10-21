import { Module } from '@nestjs/common';
import { McpService } from './mcp.service.js';
import {
  McpController,
  PortaIasPainelController,
  PortaIasPublicoController,
} from './porta-ias.controller.js';
import { PortaIasService } from './porta-ias.service.js';

/**
 * A porta para as IAs: servidor MCP com as ferramentas do agente, a página
 * do munícipe que autoriza o assistente e o painel com o que os assistentes
 * pediram.
 */
@Module({
  controllers: [
    McpController,
    PortaIasPublicoController,
    PortaIasPainelController,
  ],
  providers: [PortaIasService, McpService],
})
export class PortaIasModule {}
