export const apiHub500mPointTextFixture = `
# KMA APIHub 500m point / generated fixture without credentials
# tm             ta_chi       ta       hm
202608231430      34.1       32.0      61
202608231435      -999.0     32.3      60

  202608231440\t34.6\t32.4\t59   # provisional row
# END
`;

export const vilageForecastJsonFixture = {
  response: {
    header: {
      resultCode: "00",
      resultMsg: "NORMAL_SERVICE",
    },
    body: {
      dataType: "JSON",
      pageNo: 1,
      numOfRows: 10,
      totalCount: 4,
      items: {
        item: [
          {
            baseDate: "20260823",
            baseTime: "1400",
            category: "TMP",
            fcstDate: "20260823",
            fcstTime: "1500",
            fcstValue: "33",
            nx: 89,
            ny: 90,
          },
          {
            baseDate: "20260823",
            baseTime: "1400",
            category: "REH",
            fcstDate: "20260823",
            fcstTime: "1500",
            fcstValue: "58",
            nx: 89,
            ny: 90,
          },
          {
            baseDate: "20260823",
            baseTime: "1400",
            category: "SKY",
            fcstDate: "20260823",
            fcstTime: "1500",
            fcstValue: "3",
            nx: 89,
            ny: 90,
          },
          {
            baseDate: "20260823",
            baseTime: "1400",
            category: "TMP",
            fcstDate: "20260823",
            fcstTime: "1600",
            fcstValue: "-",
            nx: 89,
            ny: 90,
          },
        ],
      },
    },
  },
} as const;

export const apiHubWarningTextFixture = `
# KMA APIHub current warnings / generated fixture without credentials
# REG_UP REG_UP_KO REG_ID REG_KO TM_FC TM_EF WRN LVL CMD
27 대구광역시 L1070100 대구 202608231100 202608231200 H 2 1
26 부산광역시 L1080100 부산 202608231030 202608231100 H 3 1
27 대구광역시 L1070100 대구 202608231000 202608231100 W 3 1
# END
`;
