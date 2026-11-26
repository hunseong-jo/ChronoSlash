(function () {
  'use strict';

  const WORLD_W = 1200;
  const WORLD_H = 720;
  const WALL_THICKNESS = 28;

  // Handcrafted 10-Stage Campaign (all coordinates verified clear of wall overlaps)
  const STAGES = [
    {
      id: 1,
      code: '01',
      titleKo: '각성',
      titleEn: 'AWAKENING',
      parTime: 9.0,
      floorHint: 'WASD 이동 시 시간 가속  ·  좌클릭으로 대시 베기',
      player: { x: 170, y: 360 },
      walls: [
        { x: 430, y: 170, w: 36, h: 140 },
        { x: 430, y: 410, w: 36, h: 140 },
        { x: 760, y: 270, w: 36, h: 180 }
      ],
      enemies: [
        { type: 'pistol', x: 640, y: 200 },
        { type: 'pistol', x: 640, y: 520 },
        { type: 'pistol', x: 980, y: 360 }
      ]
    },
    {
      id: 2,
      code: '02',
      titleKo: '반사 신경',
      titleEn: 'DEFLECTION',
      parTime: 11.0,
      floorHint: '날아오는 붉은 탄환을 베어 패링(반사)하라  ·  우클릭으로 시간 흘리기',
      player: { x: 150, y: 360 },
      walls: [
        { x: 350, y: 28, w: 34, h: 220 },
        { x: 350, y: 472, w: 34, h: 220 },
        { x: 700, y: 200, w: 34, h: 320 }
      ],
      enemies: [
        { type: 'pistol', x: 540, y: 160 },
        { type: 'pistol', x: 540, y: 560 },
        { type: 'sniper', x: 1020, y: 180 },
        { type: 'sniper', x: 1020, y: 540 }
      ]
    },
    {
      id: 3,
      code: '03',
      titleKo: '교차 사격',
      titleEn: 'CROSSFIRE',
      parTime: 13.0,
      floorHint: '처치 또는 패링 성공 시 대시 쿨타임 즉시 초기화',
      player: { x: 600, y: 590 },
      walls: [
        { x: 540, y: 300, w: 120, h: 120 },
        { x: 240, y: 220, w: 40, h: 150 },
        { x: 920, y: 220, w: 40, h: 150 }
      ],
      enemies: [
        { type: 'shotgun', x: 200, y: 140 },
        { type: 'shotgun', x: 1000, y: 140 },
        { type: 'pistol', x: 600, y: 125 },
        { type: 'pistol', x: 180, y: 520 },
        { type: 'pistol', x: 1020, y: 520 }
      ]
    },
    {
      id: 4,
      code: '04',
      titleKo: '저격 회랑',
      titleEn: 'LASER CORRIDOR',
      parTime: 14.0,
      floorHint: '붉은 레이저 조준선을 주시하고 돌진 암살자를 먼저 끊어라',
      player: { x: 140, y: 360 },
      walls: [
        { x: 330, y: 190, w: 180, h: 32 },
        { x: 330, y: 498, w: 180, h: 32 },
        { x: 690, y: 190, w: 180, h: 32 },
        { x: 690, y: 498, w: 180, h: 32 }
      ],
      enemies: [
        { type: 'rusher', x: 580, y: 110 },
        { type: 'rusher', x: 580, y: 610 },
        { type: 'sniper', x: 1060, y: 120 },
        { type: 'sniper', x: 1060, y: 360 },
        { type: 'sniper', x: 1060, y: 600 },
        { type: 'burst', x: 780, y: 360 }
      ]
    },
    {
      id: 5,
      code: '05',
      titleKo: '방패벽',
      titleEn: 'PHALANX',
      parTime: 15.0,
      floorHint: '파란 에너지 방패는 정면 공격을 막는다  ·  등 뒤로 대시해 베어라',
      player: { x: 150, y: 360 },
      walls: [
        { x: 440, y: 120, w: 36, h: 170 },
        { x: 440, y: 430, w: 36, h: 170 },
        { x: 800, y: 240, w: 36, h: 240 }
      ],
      enemies: [
        { type: 'shield', x: 590, y: 250 },
        { type: 'shield', x: 590, y: 470 },
        { type: 'burst', x: 960, y: 160 },
        { type: 'burst', x: 960, y: 560 },
        { type: 'pistol', x: 1040, y: 360 }
      ]
    },
    {
      id: 6,
      code: '06',
      titleKo: '포위망',
      titleEn: 'ENCIRCLEMENT',
      parTime: 15.0,
      floorHint: '사방의 산탄을 역이용해 연쇄 패링으로 포위를 뚫어라',
      player: { x: 600, y: 360 },
      walls: [
        { x: 350, y: 200, w: 110, h: 32 },
        { x: 740, y: 200, w: 110, h: 32 },
        { x: 350, y: 488, w: 110, h: 32 },
        { x: 740, y: 488, w: 110, h: 32 }
      ],
      enemies: [
        { type: 'shotgun', x: 160, y: 140 },
        { type: 'shotgun', x: 1040, y: 140 },
        { type: 'shotgun', x: 160, y: 580 },
        { type: 'shotgun', x: 1040, y: 580 },
        { type: 'rusher', x: 600, y: 105 },
        { type: 'rusher', x: 600, y: 615 },
        { type: 'burst', x: 140, y: 360 },
        { type: 'burst', x: 1060, y: 360 }
      ]
    },
    {
      id: 7,
      code: '07',
      titleKo: '쌍둥이 포탑',
      titleEn: 'TWIN TURRETS',
      parTime: 16.0,
      floorHint: '자동 포탑의 탄막은 최고의 반사 탄약이다',
      player: { x: 145, y: 580 },
      walls: [
        { x: 320, y: 360, w: 180, h: 34 },
        { x: 700, y: 326, w: 180, h: 34 },
        { x: 580, y: 110, w: 36, h: 170 },
        { x: 580, y: 450, w: 36, h: 170 }
      ],
      enemies: [
        { type: 'turret', x: 410, y: 165 },
        { type: 'turret', x: 790, y: 555 },
        { type: 'sniper', x: 1050, y: 130 },
        { type: 'shield', x: 790, y: 190 },
        { type: 'shield', x: 420, y: 540 },
        { type: 'rusher', x: 1030, y: 580 }
      ]
    },
    {
      id: 8,
      code: '08',
      titleKo: '미로 암살',
      titleEn: 'SHADOW LABYRINTH',
      parTime: 18.0,
      floorHint: '벽 너머의 시야를 끊고 구역별로 돌파하라',
      player: { x: 130, y: 130 },
      walls: [
        { x: 290, y: 28, w: 32, h: 250 },
        { x: 290, y: 410, w: 32, h: 282 },
        { x: 590, y: 160, w: 32, h: 390 },
        { x: 890, y: 28, w: 32, h: 270 },
        { x: 890, y: 430, w: 32, h: 262 },
        { x: 322, y: 330, w: 130, h: 32 },
        { x: 740, y: 330, w: 150, h: 32 }
      ],
      enemies: [
        { type: 'pistol', x: 150, y: 570 },
        { type: 'rusher', x: 450, y: 160 },
        { type: 'shotgun', x: 450, y: 560 },
        { type: 'burst', x: 740, y: 160 },
        { type: 'shield', x: 740, y: 560 },
        { type: 'sniper', x: 1060, y: 140 },
        { type: 'sniper', x: 1060, y: 580 },
        { type: 'rusher', x: 1050, y: 360 }
      ]
    },
    {
      id: 9,
      code: '09',
      titleKo: '탄막 회랑',
      titleEn: 'BULLET STORM',
      parTime: 20.0,
      floorHint: '최종 관문 — 모든 테크닉으로 돌파하라',
      player: { x: 130, y: 360 },
      walls: [
        { x: 340, y: 150, w: 36, h: 120 },
        { x: 340, y: 450, w: 36, h: 120 },
        { x: 600, y: 290, w: 36, h: 140 },
        { x: 860, y: 150, w: 36, h: 120 },
        { x: 860, y: 450, w: 36, h: 120 }
      ],
      enemies: [
        { type: 'turret', x: 618, y: 120 },
        { type: 'turret', x: 618, y: 600 },
        { type: 'shield', x: 470, y: 260 },
        { type: 'shield', x: 470, y: 460 },
        { type: 'shotgun', x: 740, y: 220 },
        { type: 'shotgun', x: 740, y: 500 },
        { type: 'sniper', x: 1065, y: 130 },
        { type: 'sniper', x: 1065, y: 590 },
        { type: 'rusher', x: 960, y: 360 },
        { type: 'burst', x: 1065, y: 360 }
      ]
    },
    {
      id: 10,
      code: '10',
      titleKo: '크로노스 코어',
      titleEn: 'CHRONOS WARDEN',
      isBoss: true,
      parTime: 24.0,
      floorHint: 'BOSS: 탄환을 패링해 코어를 타격하거나, 돌진 후 경직 순간을 베어라!',
      player: { x: 180, y: 360 },
      walls: [
        { x: 370, y: 180, w: 50, h: 50 },
        { x: 370, y: 490, w: 50, h: 50 },
        { x: 780, y: 180, w: 50, h: 50 },
        { x: 780, y: 490, w: 50, h: 50 }
      ],
      enemies: [
        { type: 'boss', x: 860, y: 360 },
        { type: 'pistol', x: 600, y: 120 },
        { type: 'pistol', x: 600, y: 600 }
      ]
    }
  ];

  window.ChronoSlashLevels = {
    WORLD_W,
    WORLD_H,
    WALL_THICKNESS,
    STAGES
  };
})();
