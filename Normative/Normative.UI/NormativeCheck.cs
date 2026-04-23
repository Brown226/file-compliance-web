using Normative.Core;
using Normative.Model;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace Normative
{
    public partial class NormativeCheck : UserControl
    {
        public NormativeCheck()
        {
            InitializeComponent();
            gdv_models.AutoGenerateColumns = false;
            gdv_models.DataSource = null;
        }

        List<ItemModel> NormativeItems = new List<ItemModel>();

        #region 标准库选择

        private void rad_standard_CheckedChanged(object sender, EventArgs e)
        {
            this.btn_ImportStandard.Enabled = false;
        }

        private void rad_import_CheckedChanged(object sender, EventArgs e)
        {
            this.btn_ImportStandard.Enabled = true;
        }

        private void btn_ImportStandard_Click(object sender, EventArgs e)
        {
            try
            {
                SelfPropStandard selfPropStandard = new SelfPropStandard();
                selfPropStandard.ShowDialog();
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
        }
        #endregion

        #region 文档导入
        private void btn_importfile_Click(object sender, EventArgs e)
        {
            try
            {
                pal_cbtn.Enabled = false;
                OpenFileDialog opendialog = new OpenFileDialog();
                opendialog.Filter = "文档|*.dwg;*.pdf;*.docx;*.doc;*.xlsx;*.xls";
                opendialog.Title = "请选择文件";
                opendialog.Multiselect = true;
                if (opendialog.ShowDialog() != DialogResult.OK)
                {
                    return;
                }
                var filenames = opendialog.FileNames;
                if (filenames == null || filenames.Length == 0)
                {
                    return;
                }
                NormativeItems = new List<ItemModel>();
                foreach (var filename in filenames)
                {
                    FileInfo fi = new FileInfo(filename);
                    if (fi == null || string.IsNullOrEmpty(fi.Extension))
                    {
                        continue;
                    }
                    DocTypeEnums typeEnum = NormativeHelper.GetDocTypeEnum(fi.Extension.Trim('.').ToLower());
                    if (typeEnum == DocTypeEnums.none)
                    {
                        continue;
                    }
                    ItemModel item = new ItemModel();
                    item.FileName = fi.Name;
                    item.FilePath = filename;
                    item.DocType = typeEnum;
                    item.FileNameInfo = fi.Name.Substring(0, fi.Name.Length - fi.Extension.Length);
                    NormativeItems.Add(item);
                }
                gdv_models.DataSource = null;
                if (NormativeItems != null && NormativeItems.Count > 0)
                {
                    gdv_models.DataSource = NormativeItems;
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
            finally
            {
                pal_cbtn.Enabled = true;
            }
        }
        #endregion

        #region 文档核查
        private void btn_checkdoc_Click(object sender, EventArgs e)
        {
            try
            {
                string checkvererror = UIMarkHelper.CheckVersion();
                if (!string.IsNullOrEmpty(checkvererror))
                {
                    MessageBox.Show(checkvererror);
                    return;
                }
                if (btn_checkdoc.Text == "检查中")
                {
                    return;
                }
                if (!bgw_checkdoc.IsBusy)
                {
                    pal_cbtn.Enabled = false;
                    btn_checkdoc.Text = "检查中";
                    bgw_checkdoc.RunWorkerAsync();
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
        }

        private void bgw_checkdoc_DoWork(object sender, DoWorkEventArgs e)
        {
            try
            {
                if (NormativeItems == null || NormativeItems.Count == 0)
                {
                    MessageBox.Show("请添加需要检测的文档");
                    return;
                }
                List<StandardModel> CheckStandardInfos = new List<StandardModel>();
                if (rad_standard.Checked)
                {
                    if (NormativeDataHelper.Instance.StandardInfos == null || NormativeDataHelper.Instance.StandardInfos.Count == 0)
                    {
                        MessageBox.Show("标准库未获取到数据，请联系管理员");
                        return;
                    }
                    CheckStandardInfos = NormativeDataHelper.Instance.StandardInfos;
                }
                else
                {
                    if (NormativeDataHelper.Instance.SelfStandardInfos == null || NormativeDataHelper.Instance.SelfStandardInfos.Count == 0)
                    {
                        MessageBox.Show("请上传标准规范数据");
                        return;
                    }
                    CheckStandardInfos = NormativeDataHelper.Instance.SelfStandardInfos;
                }

                for (int i = 0; i < NormativeItems.Count; i++)
                {
                    var item = NormativeItems[i];
                    item.MessInfo = "";
                    NormativeHelper.CheckDoc(item, CheckStandardInfos);
                    CommHelper.refreshgrid(gdv_models, i);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
        }

        private void bgw_checkdoc_RunWorkerCompleted(object sender, RunWorkerCompletedEventArgs e)
        {
            btn_checkdoc.Text = "规范引用检查";
            pal_cbtn.Enabled = true;
        }
        #endregion

        #region 核查结果导出
        private void btn_export_Click(object sender, EventArgs e)
        {
            try
            {
                pal_cbtn.Enabled = false;
                if (NormativeItems == null || NormativeItems.Count == 0)
                {
                    MessageBox.Show("请添加文档，检查完成后才可导出结果");
                    return;
                }
                if (NormativeItems.Any(t => string.IsNullOrEmpty(t.MessInfo)))
                {
                    MessageBox.Show("检查完成后才可导出结果");
                    return;
                }

                SaveFileDialog sf = new SaveFileDialog();
                SaveFileDialog save = new SaveFileDialog();
                save.Filter = ".xlsx(文件)|*.xlsx";
                save.Title = "请选择文件保存路径";
                save.FileName = DateTime.Now.ToFileTime().ToString();
                if (save.ShowDialog() != DialogResult.OK)
                {
                    return;
                }
                NormativeHelper.ExportResult(save.FileName, NormativeItems);
                MessageBox.Show("导出完成");

            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
            finally
            {
                pal_cbtn.Enabled = true;
            }
        }
        #endregion

        #region 清空
        private void btn_clear_Click(object sender, EventArgs e)
        {
            try
            {               
                pal_cbtn.Enabled = false;
                NormativeItems = new List<ItemModel>();
                gdv_models.DataSource = null;
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
            finally
            {
                pal_cbtn.Enabled = true;
            }
        }
        #endregion

        #region 列表操作
        private void gdv_models_RowPostPaint(object sender, DataGridViewRowPostPaintEventArgs e)
        {
            try
            {
                var grid = sender as DataGridView;
                var rowidx = (e.RowIndex + 1).ToString();
                var centerformat = new StringFormat()
                {
                    Alignment = StringAlignment.Center,
                    LineAlignment = StringAlignment.Center
                };
                var headerbounds = new Rectangle(e.RowBounds.Left, e.RowBounds.Top, grid.RowHeadersWidth, e.RowBounds.Height);
                e.Graphics.DrawString(rowidx, this.Font, SystemBrushes.ControlText, headerbounds, centerformat);
            }
            catch (Exception)
            {

            }
        }

        private void gdv_models_CellContentClick(object sender, DataGridViewCellEventArgs e)
        {
            try
            {
                int ridx = e.RowIndex;
                int cidx = e.ColumnIndex;
                if (gdv_models.Columns[cidx].Name == "MessInfo")
                {
                    var cellval = gdv_models.Rows[ridx].Cells[cidx].Value;
                    if (cellval != null && cellval.ToString() == "查看详情")
                    {
                        ItemModel docitemmodel = NormativeItems[ridx];
                        CheckResults infofrm = new CheckResults(docitemmodel);
                        infofrm.ShowDialog();
                    }
                }
            }
            catch (Exception ex)
            {

            }
        }
        #endregion
    }
}
