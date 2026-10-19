import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseService } from './database/database.service.js';
import { ClaudeService } from './ia/claude.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DatabaseService, useValue: { enabled: false } },
        { provide: ClaudeService, useValue: { disponivel: false } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('saude sem BD nem IA responde ok com bd=false e ia=false', async () => {
    await expect(appController.saude()).resolves.toEqual({
      ok: true,
      bd: false,
      ia: false,
    });
  });
});
