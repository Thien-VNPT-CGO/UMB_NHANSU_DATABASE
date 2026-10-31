const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const key = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../key.json'), 'utf8'));

const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

const MAP = {
  FROM_NHAN_VIEN: '1kBpYSBKT-UQhTRzOU_38lZ34B78ZrzErDgydC5pubY8',
  NHAN_VIEN_MASTER: '1XvASWXUqltONLwvV1m2PIdi7BtRYZbyW-BYZj00xUsQ',
  PHAN_CONG_CA: '1pLbQxCWQthwhcSo2MJmGAWS_pZPisyEpWeImc0p0l0Q',
  TAI_KHOAN_NHAN_VIEN: '1Mr-ux8IWMKa4vqUgWo55wyDLO1wfMlycPH17mltOeZQ',
  SU_KIEN_DIEM_DANH: '1n8zK3R7ZS8WV2wdLBmDegrxe6qKkRk6NDn3skKKZ374',
  DON_NGHI_PHEP: '1pvsdb4-im6Gz-MGTWX6CK3FQg_EPxvdu_77njFTzHLc',
  DON_DOI_CA: '1sfMrfPv6enH9_OTTZMwX98tL7CX2lRNh91LUMwkpl_U',
  THONGBAO_NV: '13hUNoKT8U1Li_EIyx3bxNGQaiuVvsiXY_ussblJpWRE',
  DIEU_CHINH_CONG: '1zixbn7FSqvEALYTOsG5dZttT2Wf6w4zIvjPuz1NuBL0',
  KY_LUONG: '13kwbYcXQ9SsNs6hlpB5BmAx8pdO-xLT1qsrRdU8xaA0',
  CHI_TIET_LUONG: '1Kwnto75bUxlMsWGGxTYVqFq3I7Ty0nik6JL90_dIFY0',
  AUDIT_LOG: '1PPJZPjaCMC4_17nQItZgdN5Jq0ILtdZgi0ZJawmXtLg',
  DANH_SACH_CHI_NHANH: '1b5EdX23uZQw9RtmBEPqFKvd9R2qkLbfrjNO7c8R32So',
  ADMIN_ACCOUNTS: '1z0Gu7JrK7mdNMu4N-WmMt3HTaKA56DM3_LY_9QRSSXU',
  CAU_HINH_HE_THONG: '1JcJsEMBhS_RQR68prdTvDtsdn0ONgKxO_4U-04Pvpdo',
  BAI_THI: '1aomZUt7YYy4J2fUjHavVJdcrcaTNWmjOSIh-qJlgQ64',
  BAI_LAM: '1YypwqMcwKUT_CU86UmUvb8oXmGUPi9HhFGG1ykSJ-Js',
  LUUTRU_CHAMCONG_TUAN: '159EMCALHp1b_WmiprHmkrgDq6peAyP0NEkQ729aSUZM',
  PHIEU_LUONG: '1aRZ2IL2z3yqQYr1YKEI1SSdJG4VRrqyzaz9KKW8kI10',
  LICH_SU_GIAI_DOAN: '1FA0sIFNGP8L7Jb6tVHFt043s11m83KC1tCp38XaJDYc',
  CONG_THUC_LUONG: '1YptJQybfT7FXxcrJaR_FFak8fPUDLTe4YQgYH7RBY-s',
  DULIEU_LUONG_KY: '1i-vnz5L1errwNE7y1PqYdVzaF1oMFOD0C-IRRdCzzYY',
  THONGBAO_GUI: '12lTHxPn80hOnLNE8fvNno08tURZfqvPPhiOeFzS47p8',
  SNAPSHOT_SAOLUU: '10CYuaiPqWwbTfWBCw9JGXCjcBzzwZUtpBnOP5NuzZpQ',
  PHIEU_NV_CAP_NHAT_CA: '1ZtR2jm8xYeh3P08ipSkG0BTJfqzerU7EMJVJFxeLr_U'
};

async function verifyAll() {
  console.log('Verifying all 25 sheets...');
  const results = [];
  for (const [name, id] of Object.entries(MAP)) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `'${name}'!A1:B2`
      });
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
      const grid = meta.data.sheets[0].properties.gridProperties;
      results.push({
        Tab: name,
        TabName: meta.data.sheets[0].properties.title,
        FirstCell: res.data.values?.[0]?.[0] || '(empty)',
        GridRows: grid.rowCount,
        Status: 'OK'
      });
      process.stdout.write('.');
    } catch (err) {
      results.push({ Tab: name, Status: 'ERROR', Error: err.message });
      process.stdout.write('X');
    }
  }
  console.log('\n');
  console.table(results);
}

verifyAll();
