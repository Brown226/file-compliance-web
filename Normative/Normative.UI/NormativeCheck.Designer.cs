namespace Normative
{
    partial class NormativeCheck
    {
        /// <summary>
        /// 必需的设计器变量。
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// 清理所有正在使用的资源。
        /// </summary>
        /// <param name="disposing">如果应释放托管资源，为 true；否则为 false。</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows 窗体设计器生成的代码

        /// <summary>
        /// 设计器支持所需的方法 - 不要修改
        /// 使用代码编辑器修改此方法的内容。
        /// </summary>
        private void InitializeComponent()
        {
            this.gdv_models = new System.Windows.Forms.DataGridView();
            this.FileName = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.StrDocType = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.MessInfo = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.btn_checkdoc = new System.Windows.Forms.Button();
            this.btn_importfile = new System.Windows.Forms.Button();
            this.btn_export = new System.Windows.Forms.Button();
            this.bgw_checkdoc = new System.ComponentModel.BackgroundWorker();
            this.pal_cbtn = new System.Windows.Forms.Panel();
            this.btn_clear = new System.Windows.Forms.Button();
            this.btn_ImportStandard = new System.Windows.Forms.Button();
            this.rad_import = new System.Windows.Forms.RadioButton();
            this.rad_standard = new System.Windows.Forms.RadioButton();
            ((System.ComponentModel.ISupportInitialize)(this.gdv_models)).BeginInit();
            this.pal_cbtn.SuspendLayout();
            this.SuspendLayout();
            // 
            // gdv_models
            // 
            this.gdv_models.AllowUserToAddRows = false;
            this.gdv_models.Anchor = ((System.Windows.Forms.AnchorStyles)((((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom) 
            | System.Windows.Forms.AnchorStyles.Left) 
            | System.Windows.Forms.AnchorStyles.Right)));
            this.gdv_models.BackgroundColor = System.Drawing.SystemColors.ButtonHighlight;
            this.gdv_models.ColumnHeadersHeightSizeMode = System.Windows.Forms.DataGridViewColumnHeadersHeightSizeMode.AutoSize;
            this.gdv_models.Columns.AddRange(new System.Windows.Forms.DataGridViewColumn[] {
            this.FileName,
            this.StrDocType,
            this.MessInfo});
            this.gdv_models.Location = new System.Drawing.Point(5, 52);
            this.gdv_models.Name = "gdv_models";
            this.gdv_models.RowTemplate.Height = 23;
            this.gdv_models.Size = new System.Drawing.Size(801, 393);
            this.gdv_models.TabIndex = 21;
            this.gdv_models.CellContentClick += new System.Windows.Forms.DataGridViewCellEventHandler(this.gdv_models_CellContentClick);
            this.gdv_models.RowPostPaint += new System.Windows.Forms.DataGridViewRowPostPaintEventHandler(this.gdv_models_RowPostPaint);
            // 
            // FileName
            // 
            this.FileName.DataPropertyName = "FileName";
            this.FileName.HeaderText = "文档名称";
            this.FileName.Name = "FileName";
            this.FileName.ReadOnly = true;
            this.FileName.Width = 300;
            // 
            // StrDocType
            // 
            this.StrDocType.DataPropertyName = "StrDocType";
            this.StrDocType.HeaderText = "文档类型";
            this.StrDocType.Name = "StrDocType";
            this.StrDocType.ReadOnly = true;
            // 
            // MessInfo
            // 
            this.MessInfo.DataPropertyName = "MessInfo";
            this.MessInfo.HeaderText = "提示信息";
            this.MessInfo.Name = "MessInfo";
            this.MessInfo.ReadOnly = true;
            this.MessInfo.Width = 200;
            // 
            // btn_checkdoc
            // 
            this.btn_checkdoc.Location = new System.Drawing.Point(346, 6);
            this.btn_checkdoc.Name = "btn_checkdoc";
            this.btn_checkdoc.Size = new System.Drawing.Size(96, 30);
            this.btn_checkdoc.TabIndex = 25;
            this.btn_checkdoc.Text = "规范引用检查";
            this.btn_checkdoc.UseVisualStyleBackColor = true;
            this.btn_checkdoc.Click += new System.EventHandler(this.btn_checkdoc_Click);
            // 
            // btn_importfile
            // 
            this.btn_importfile.Location = new System.Drawing.Point(262, 6);
            this.btn_importfile.Name = "btn_importfile";
            this.btn_importfile.Size = new System.Drawing.Size(75, 30);
            this.btn_importfile.TabIndex = 24;
            this.btn_importfile.Text = "添加文档";
            this.btn_importfile.UseVisualStyleBackColor = true;
            this.btn_importfile.Click += new System.EventHandler(this.btn_importfile_Click);
            // 
            // btn_export
            // 
            this.btn_export.Location = new System.Drawing.Point(451, 6);
            this.btn_export.Name = "btn_export";
            this.btn_export.Size = new System.Drawing.Size(75, 30);
            this.btn_export.TabIndex = 26;
            this.btn_export.Text = "导出结果";
            this.btn_export.UseVisualStyleBackColor = true;
            this.btn_export.Click += new System.EventHandler(this.btn_export_Click);
            // 
            // bgw_checkdoc
            // 
            this.bgw_checkdoc.WorkerReportsProgress = true;
            this.bgw_checkdoc.DoWork += new System.ComponentModel.DoWorkEventHandler(this.bgw_checkdoc_DoWork);
            this.bgw_checkdoc.RunWorkerCompleted += new System.ComponentModel.RunWorkerCompletedEventHandler(this.bgw_checkdoc_RunWorkerCompleted);
            // 
            // pal_cbtn
            // 
            this.pal_cbtn.Controls.Add(this.btn_clear);
            this.pal_cbtn.Controls.Add(this.btn_ImportStandard);
            this.pal_cbtn.Controls.Add(this.rad_import);
            this.pal_cbtn.Controls.Add(this.rad_standard);
            this.pal_cbtn.Controls.Add(this.btn_importfile);
            this.pal_cbtn.Controls.Add(this.btn_export);
            this.pal_cbtn.Controls.Add(this.btn_checkdoc);
            this.pal_cbtn.Location = new System.Drawing.Point(3, 3);
            this.pal_cbtn.Name = "pal_cbtn";
            this.pal_cbtn.Size = new System.Drawing.Size(624, 43);
            this.pal_cbtn.TabIndex = 27;
            // 
            // btn_clear
            // 
            this.btn_clear.Location = new System.Drawing.Point(535, 6);
            this.btn_clear.Name = "btn_clear";
            this.btn_clear.Size = new System.Drawing.Size(75, 30);
            this.btn_clear.TabIndex = 30;
            this.btn_clear.Text = "清空";
            this.btn_clear.UseVisualStyleBackColor = true;
            this.btn_clear.Click += new System.EventHandler(this.btn_clear_Click);
            // 
            // btn_ImportStandard
            // 
            this.btn_ImportStandard.Enabled = false;
            this.btn_ImportStandard.Location = new System.Drawing.Point(178, 6);
            this.btn_ImportStandard.Name = "btn_ImportStandard";
            this.btn_ImportStandard.Size = new System.Drawing.Size(75, 30);
            this.btn_ImportStandard.TabIndex = 29;
            this.btn_ImportStandard.Text = "导入标准";
            this.btn_ImportStandard.UseVisualStyleBackColor = true;
            this.btn_ImportStandard.Click += new System.EventHandler(this.btn_ImportStandard_Click);
            // 
            // rad_import
            // 
            this.rad_import.AutoSize = true;
            this.rad_import.Location = new System.Drawing.Point(76, 13);
            this.rad_import.Name = "rad_import";
            this.rad_import.Size = new System.Drawing.Size(95, 16);
            this.rad_import.TabIndex = 28;
            this.rad_import.Text = "自行导入标准";
            this.rad_import.UseVisualStyleBackColor = true;
            this.rad_import.CheckedChanged += new System.EventHandler(this.rad_import_CheckedChanged);
            // 
            // rad_standard
            // 
            this.rad_standard.AutoSize = true;
            this.rad_standard.Checked = true;
            this.rad_standard.Location = new System.Drawing.Point(9, 13);
            this.rad_standard.Name = "rad_standard";
            this.rad_standard.Size = new System.Drawing.Size(59, 16);
            this.rad_standard.TabIndex = 27;
            this.rad_standard.TabStop = true;
            this.rad_standard.Text = "标准库";
            this.rad_standard.UseVisualStyleBackColor = true;
            this.rad_standard.CheckedChanged += new System.EventHandler(this.rad_standard_CheckedChanged);
            // 
            // NormativeCheck
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 12F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.Controls.Add(this.pal_cbtn);
            this.Controls.Add(this.gdv_models);
            this.Name = "NormativeCheck";
            this.Size = new System.Drawing.Size(810, 450);
            ((System.ComponentModel.ISupportInitialize)(this.gdv_models)).EndInit();
            this.pal_cbtn.ResumeLayout(false);
            this.pal_cbtn.PerformLayout();
            this.ResumeLayout(false);

        }

        #endregion

        private System.Windows.Forms.DataGridView gdv_models;
        private System.Windows.Forms.Button btn_checkdoc;
        private System.Windows.Forms.Button btn_importfile;
        private System.Windows.Forms.Button btn_export;
        private System.ComponentModel.BackgroundWorker bgw_checkdoc;
        private System.Windows.Forms.DataGridViewTextBoxColumn FileName;
        private System.Windows.Forms.DataGridViewTextBoxColumn StrDocType;
        private System.Windows.Forms.DataGridViewTextBoxColumn MessInfo;
        private System.Windows.Forms.Panel pal_cbtn;
        private System.Windows.Forms.RadioButton rad_import;
        private System.Windows.Forms.RadioButton rad_standard;
        private System.Windows.Forms.Button btn_ImportStandard;
        private System.Windows.Forms.Button btn_clear;
    }
}

