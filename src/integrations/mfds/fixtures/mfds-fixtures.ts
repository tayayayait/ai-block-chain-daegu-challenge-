export const pillResponseFixture = {
  header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
  body: {
    pageNo: 1,
    numOfRows: 10,
    totalCount: 1,
    items: [
      {
        ITEM_SEQ: "200000001",
        ITEM_NAME: "온중정10밀리그램",
        ENTP_NAME: "온중제약",
        PRINT_FRONT: "ON",
        PRINT_BACK: "10",
        DRUG_SHAPE: "원형",
        COLOR_CLASS1: "하양",
        COLOR_CLASS2: "",
        ITEM_IMAGE: "https://example.test/pill.png",
      },
    ],
  },
} as const;

export const easyDrugResponseFixture = {
  header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
  body: {
    pageNo: 1,
    numOfRows: 10,
    totalCount: 1,
    items: [
      {
        entpName: "온중제약",
        itemName: "온중정10밀리그램",
        itemSeq: "200000001",
        efcyQesitm: "허가된 효능 정보",
        useMethodQesitm: "허가된 용법 정보",
        atpnWarnQesitm: "경고 정보",
        atpnQesitm: "주의사항 정보",
        intrcQesitm: "상호작용 정보",
        seQesitm: "이상반응 정보",
        depositMethodQesitm: "보관 정보",
        openDe: "20260101",
        updateDe: "20260801",
        itemImage: "https://example.test/easy-drug.png",
      },
    ],
  },
} as const;

const commonDurItem = {
  ITEM_SEQ: "200000001",
  ITEM_NAME: "온중정10밀리그램",
  ENTP_NAME: "온중제약",
  INGREDIENT_NAME: "클로르페니라민말레산염",
} as const;

export const durResponseFixtures = {
  PRODUCT: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: { pageNo: 1, numOfRows: 10, totalCount: 1, items: [{ ...commonDurItem }] },
  },
  COMBINATION_CONTRAINDICATION: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: {
      pageNo: 1,
      numOfRows: 10,
      totalCount: 1,
      items: [
        {
          ...commonDurItem,
          MIXTURE_ITEM_SEQ: "200000002",
          MIXTURE_ITEM_NAME: "상대약정",
          PROHBT_CONTENT: "병용금기 내용",
        },
      ],
    },
  },
  ELDERLY_CAUTION: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: {
      pageNo: 1,
      numOfRows: 10,
      totalCount: 1,
      items: [{ ...commonDurItem, PROHBT_CONTENT: "노인주의 내용" }],
    },
  },
  AGE_CONTRAINDICATION: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: {
      pageNo: 1,
      numOfRows: 10,
      totalCount: 1,
      items: [{ ...commonDurItem, SPECIFIC_AGE: "12", PROHBT_CONTENT: "연령금기 내용" }],
    },
  },
  CAPACITY_CAUTION: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: {
      pageNo: 1,
      numOfRows: 10,
      totalCount: 1,
      items: [{ ...commonDurItem, MAX_QTY: "10mg", PROHBT_CONTENT: "용량주의 내용" }],
    },
  },
  DURATION_CAUTION: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: {
      pageNo: 1,
      numOfRows: 10,
      totalCount: 1,
      items: [{ ...commonDurItem, MAX_DAYS: "7", PROHBT_CONTENT: "기간주의 내용" }],
    },
  },
  EFFICACY_DUPLICATION: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: {
      pageNo: 1,
      numOfRows: 10,
      totalCount: 1,
      items: [{ ...commonDurItem, DUR_TYPE_NAME: "항히스타민제", PROHBT_CONTENT: "중복주의" }],
    },
  },
  EXTENDED_RELEASE_SPLIT_CAUTION: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: {
      pageNo: 1,
      numOfRows: 10,
      totalCount: 1,
      items: [{ ...commonDurItem, PROHBT_CONTENT: "서방정 분할주의" }],
    },
  },
  PREGNANCY_CONTRAINDICATION: {
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: {
      pageNo: 1,
      numOfRows: 10,
      totalCount: 1,
      items: [{ ...commonDurItem, GRADE: "2", PROHBT_CONTENT: "임부금기 내용" }],
    },
  },
} as const;

export const emptyMfdsResponseFixture = {
  header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
  body: { pageNo: 1, numOfRows: 10, totalCount: 0, items: [] },
} as const;
