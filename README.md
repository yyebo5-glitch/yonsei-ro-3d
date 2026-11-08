# 연세로 3D

연세대 정문에서 남쪽으로 2km, 신촌 연세로 일대를 three.js로 구현한 웹 3D 맵입니다.

## 실행

```bash
npm ci
npm run dev
```

`http://localhost:5183` 을 엽니다.

## 조작

| 키 | 동작 |
|---|---|
| 1~8 | 시점 이동 |
| V | 궤도 / 걷기 / 비행 전환 |
| T | 낮 / 노을 / 밤 전환 |
| H | UI 숨기기 |

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 빌드해 GitHub Pages에 올립니다.
저장소 Settings > Pages의 Source를 **GitHub Actions**로 설정해야 합니다.

## 데이터 다시 만들기

`raw/`의 원본에서 `public/data/`를 생성합니다.

```bash
npm run world
```

간판 색상, 추가 상호, 건물 층수는 `tools/street-references.mjs`에서 고칠 수 있습니다.

## 데이터 출처와 정확도

- 지도 데이터: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL)
- 고도: Terrain Tiles (Mapzen/AWS)
- 건물 높이는 일부만 실측이고, 나머지는 주변 건물과 규칙으로 추정한 값입니다.
- 건물 외관은 절차적으로 생성한 것이며, 간판은 로고 없이 상호 글자만 표시합니다. 실제 현황과 다를 수 있습니다.
